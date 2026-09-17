using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Timers;
using Microsoft.Extensions.Logging;

namespace VultStrikeReporter;

public class PlayerStats
{
    public string SteamId { get; set; } = "";
    public string Name { get; set; } = "";
    public int Kills { get; set; }
    public int Deaths { get; set; }
    public int Assists { get; set; }
    public int Damage { get; set; }
}

[MinimumApiVersion(80)]
public class VultStrikeReporterPlugin : BasePlugin
{
    public override string ModuleName => "VultStrike: Match Reporter";
    public override string ModuleVersion => "0.3.4";
    public override string ModuleAuthor => "VultStrike";
    public override string ModuleDescription => "Reports match results, live updates, and player stats to VultStrike API.";

    private static readonly HttpClient Http = new();

    private int _tScore;
    private int _ctScore;
    private int _tScoreRaw;
    private int _ctScoreRaw;
    private int _tScoreOffset;
    private int _ctScoreOffset;
    private int _currentRound;
    private DateTime _matchStartTime;
    private CounterStrikeSharp.API.Modules.Timers.Timer? _updateTimer;
    private CounterStrikeSharp.API.Modules.Timers.Timer? _shutdownTimer;
    private readonly Dictionary<string, PlayerStats> _playerStats = new();
    private readonly HashSet<string> _connectedPlayers = new();
    private bool _warmupReduced = false;
    private bool _scoreUpdatedThisRound = false;
    private bool _liveStarted = false;
    private bool _sidesSwapped = false;
    private bool? _alphaStartsCt = null;
    private readonly Dictionary<string, string> _teamBySteamId = new();
    private DateTime _lastStatsSentAt = DateTime.MinValue;
    private bool _warmupSeen = false;
    private bool _inWarmup = false;
    private bool _warmupEnded = false;
    private bool _swapRecorded = false;
    private int _ctScoreAtSwap = 0;
    private int _tScoreAtSwap = 0;
    private string? _alphaSteamId = null;
    private bool _matchCancelledForNoShow = false;
    private readonly Dictionary<string, CounterStrikeSharp.API.Modules.Timers.Timer> _teamEnforceTimers = new();
    private const float TeamAssignIntervalSeconds = 1.5f;
    private const int TeamAssignMaxAttempts = 10;
    private const float TeamChangeCooldownSeconds = 0.5f;
    private readonly Dictionary<string, DateTime> _lastTeamEnforceAt = new();
    private readonly HashSet<string> _teamLocked = new();
    private bool AllowBots => (Environment.GetEnvironmentVariable("VS_ALLOW_BOTS") ?? "0") == "1";
    private int BotQuota => int.TryParse(Environment.GetEnvironmentVariable("VS_BOT_QUOTA"), out var v) ? v : 1;
    private string? BotTeam => Environment.GetEnvironmentVariable("VS_BOT_TEAM");
    private bool AutoShutdownEnabled => (Environment.GetEnvironmentVariable("VS_AUTO_SHUTDOWN") ?? "0") == "1";
    private bool AllowUnknownPlayersFallback => (Environment.GetEnvironmentVariable("VS_ALLOW_UNKNOWN_PLAYERS") ?? "0") == "1";

    private string MatchId => Environment.GetEnvironmentVariable("VS_MATCH_ID") ?? "";
    private string WebhookUrl => Environment.GetEnvironmentVariable("VS_WEBHOOK_URL") ?? "";
    private string WebhookSecret => Environment.GetEnvironmentVariable("VS_WEBHOOK_SECRET") ?? "";
    private string ApiBaseUrl => Environment.GetEnvironmentVariable("VS_API_BASE") ?? "";
    private int TargetWins => int.TryParse(Environment.GetEnvironmentVariable("VS_TARGET_WINS"), out var v) ? v : 13;
    private int ShutdownDelaySeconds => int.TryParse(Environment.GetEnvironmentVariable("VS_SHUTDOWN_DELAY"), out var v) ? v : 30;
    private int SideSwapRound => int.TryParse(Environment.GetEnvironmentVariable("VS_SIDE_SWAP_ROUND"), out var v) ? v : 12;
    private int StatsIntervalSeconds => int.TryParse(Environment.GetEnvironmentVariable("VS_STATS_INTERVAL"), out var v) ? v : 15;
    private int ExpectedPlayers => ParseExpectedPlayers();

    private int ParseExpectedPlayers()
    {
        if (int.TryParse(Environment.GetEnvironmentVariable("VS_EXPECTED_PLAYERS"), out var v) && v > 0)
        {
            return v;
        }

        // Fallback: if roster loaded successfully, use it to avoid premature warmup shortening.
        if (_authorizedPlayersLoaded && !_allowUnknownPlayers && _authorizedSteamIds.Count > 0)
        {
            return _authorizedSteamIds.Count;
        }

        return 2;
    }

    private static bool IsValidSteamIdForMatch(string? steamId)
    {
        if (string.IsNullOrWhiteSpace(steamId)) return false;
        if (steamId == "0") return false;
        return true;
    }

    private void TryResolveAlphaStartFromConnectedPlayers()
    {
        if (_alphaStartsCt != null) return;
        try
        {
            foreach (var player in Utilities.GetPlayers())
            {
                if (player == null || !player.IsValid) continue;
                var steamId = GetSteamIdString(player);
                if (string.IsNullOrEmpty(steamId)) continue;
                TrySetAlphaStart(player, steamId);
                if (_alphaStartsCt != null) return;
            }
        }
        catch
        {
            // ignore roster reflection/enumeration errors
        }
    }

    private (int alpha, int bravo) MapScoresToTeams(int ctScore, int tScore)
    {
        TryResolveAlphaStartFromConnectedPlayers();
        var ctIsAlpha = _alphaStartsCt ?? true;
        if (_sidesSwapped && _swapRecorded)
        {
            if (ctIsAlpha)
            {
                var alpha = _ctScoreAtSwap + Math.Max(0, tScore - _tScoreAtSwap);
                var bravo = _tScoreAtSwap + Math.Max(0, ctScore - _ctScoreAtSwap);
                return (alpha, bravo);
            }
            var alphaAlt = _tScoreAtSwap + Math.Max(0, ctScore - _ctScoreAtSwap);
            var bravoAlt = _ctScoreAtSwap + Math.Max(0, tScore - _tScoreAtSwap);
            return (alphaAlt, bravoAlt);
        }
        return ctIsAlpha ? (ctScore, tScore) : (tScore, ctScore);
    }

    private static int? GetPlayerTeamId(CCSPlayerController player)
    {
        var type = player.GetType();
        var prop = type.GetProperty("TeamNum") ?? type.GetProperty("Team");
        if (prop == null) return null;
        var value = prop.GetValue(player);
        if (value is int i) return i;
        if (value is Enum e) return Convert.ToInt32(e);
        try
        {
            // CounterStrikeSharp often exposes team as a byte/short netvar.
            if (value is IConvertible convertible)
            {
                return Convert.ToInt32(convertible);
            }
        }
        catch
        {
            // ignore conversion errors
        }
        return null;
    }

    private int GetDesiredTeamId(string team)
    {
        var alphaStartsCt = _alphaStartsCt ?? true;
        var alphaIsCt = alphaStartsCt;
        if (_sidesSwapped && _swapRecorded)
        {
            alphaIsCt = !alphaIsCt;
        }

        if (team.Equals("ALPHA", StringComparison.OrdinalIgnoreCase))
        {
            return alphaIsCt ? 3 : 2;
        }

        return alphaIsCt ? 2 : 3;
    }

    private void EnsureTeamAssignment(CCSPlayerController player, string team)
    {
        var desiredTeamId = GetDesiredTeamId(team);
        var currentTeamId = GetPlayerTeamId(player);
        if (currentTeamId == desiredTeamId) return;

        try
        {
            var type = player.GetType();
            var method = type.GetMethod("SwitchTeam") ?? type.GetMethod("ChangeTeam");
            if (method != null)
            {
                var paramType = method.GetParameters().FirstOrDefault()?.ParameterType;
                object arg = desiredTeamId;
                if (paramType != null)
                {
                    if (paramType.IsEnum)
                    {
                        arg = Enum.ToObject(paramType, desiredTeamId);
                    }
                    else if (paramType == typeof(byte))
                    {
                        arg = (byte)desiredTeamId;
                    }
                    else if (paramType == typeof(uint))
                    {
                        arg = (uint)desiredTeamId;
                    }
                    else if (paramType == typeof(short))
                    {
                        arg = (short)desiredTeamId;
                    }
                }
                method.Invoke(player, new object[] { arg });
                return;
            }
        }
        catch (Exception e)
        {
            Logger.LogDebug(e, "[vultstrike] failed to switch team via API");
        }

        // Fallback: client command
        try
        {
            player.ExecuteClientCommand($"jointeam {desiredTeamId}");
            player.ExecuteClientCommand($"jointeam {desiredTeamId} 1");
        }
        catch (Exception e)
        {
            Logger.LogDebug(e, "[vultstrike] failed to switch team via jointeam");
        }
    }

    private void StartLiveMatch(string reason)
    {
        if (_matchCancelledForNoShow) return;
        _liveStarted = true;
        _inWarmup = false;
        _warmupSeen = true;
        _warmupEnded = true;
        _currentRound = 0;
        _matchStartTime = DateTime.UtcNow;
        _tScore = 0;
        _ctScore = 0;
        _tScoreRaw = 0;
        _ctScoreRaw = 0;
        _tScoreOffset = 0;
        _ctScoreOffset = 0;
        _sidesSwapped = false;
        _swapRecorded = false;
        _ctScoreAtSwap = 0;
        _tScoreAtSwap = 0;
        ResetStatsAndPost();
        EnforceTeamsAfterLiveStart();
        // Respawn-on-death is warmup-only; disable for the live match.
        // Delay slightly so a forced team switch during the transition doesn't leave someone dead.
        AddTimer(3.0f, () =>
        {
            Server.ExecuteCommand("mp_respawn_on_death_ct 0");
            Server.ExecuteCommand("mp_respawn_on_death_t 0");
        }, TimerFlags.STOP_ON_MAPCHANGE);
        Logger.LogInformation("[vultstrike] live match started ({Reason}); stats reset", reason);
    }

    private void EnforceTeamsAfterLiveStart()
    {
        if (!_authorizedPlayersLoaded || _allowUnknownPlayers) return;
        try
        {
            foreach (var player in Utilities.GetPlayers())
            {
                if (player == null || !player.IsValid) continue;
                var steamId = GetSteamIdString(player);
                if (string.IsNullOrEmpty(steamId)) continue;
                if (_teamBySteamId.TryGetValue(steamId, out var team))
                {
                    EnforceTeamImmediate(player, steamId, team);
                }
            }
        }
        catch (Exception e)
        {
            Logger.LogDebug(e, "[vultstrike] failed to enforce teams after live start");
        }
    }

    private void EnforceTeamLocksDuringLiveMatch()
    {
        if (!_liveStarted || _matchCancelledForNoShow) return;
        if (!_authorizedPlayersLoaded || _allowUnknownPlayers) return;

        try
        {
            foreach (var player in Utilities.GetPlayers())
            {
                if (player == null || !player.IsValid) continue;
                var steamId = GetSteamIdString(player);
                if (string.IsNullOrEmpty(steamId)) continue;
                if (!_teamBySteamId.TryGetValue(steamId, out var team)) continue;
                EnforceTeamImmediate(player, steamId, team);
            }
        }
        catch (Exception e)
        {
            Logger.LogDebug(e, "[vultstrike] failed periodic team lock enforcement");
        }
    }

    private bool HasConnectedPlayersForBothSides()
    {
        // Do not start live until roster loads unless fallback is explicitly enabled.
        if (!_authorizedPlayersLoaded)
        {
            return false;
        }

        if (_allowUnknownPlayers || _teamBySteamId.Count == 0)
        {
            return _connectedPlayers.Count >= ExpectedPlayers;
        }

        var expectedAlpha = 0;
        var expectedBravo = 0;
        foreach (var team in _teamBySteamId.Values)
        {
            if (team.Equals("ALPHA", StringComparison.OrdinalIgnoreCase)) expectedAlpha++;
            if (team.Equals("BRAVO", StringComparison.OrdinalIgnoreCase)) expectedBravo++;
        }

        var connectedAlpha = 0;
        var connectedBravo = 0;
        foreach (var steamId in _connectedPlayers)
        {
            if (!_teamBySteamId.TryGetValue(steamId, out var team)) continue;
            if (team.Equals("ALPHA", StringComparison.OrdinalIgnoreCase)) connectedAlpha++;
            if (team.Equals("BRAVO", StringComparison.OrdinalIgnoreCase)) connectedBravo++;
        }

        if (expectedAlpha > 0 && connectedAlpha < expectedAlpha) return false;
        if (expectedBravo > 0 && connectedBravo < expectedBravo) return false;
        return true;
    }

    private void TryShortenWarmupIfReady()
    {
        if (_matchCancelledForNoShow) return;
        if (!_authorizedPlayersLoaded) return;
        if (!_inWarmup || _warmupEnded || _liveStarted || _warmupReduced) return;
        if (_connectedPlayers.Count < ExpectedPlayers) return;

        _warmupReduced = true;
        Server.ExecuteCommand("mp_warmuptime 15");
        Server.ExecuteCommand("mp_warmup_pausetimer 0");
        Server.ExecuteCommand("mp_warmup_start");
        _inWarmup = true;
        _warmupSeen = true;
        _warmupEnded = false;
        Logger.LogInformation("[vultstrike] warmup shortened to 15s after {Count}/{Expected} authorized players connected", _connectedPlayers.Count, ExpectedPlayers);
    }

    private void CancelMatchForNoShow(string reason)
    {
        if (_matchCancelledForNoShow) return;
        _matchCancelledForNoShow = true;
        _inWarmup = false;
        _warmupEnded = true;
        _liveStarted = false;

        _updateTimer?.Kill();
        _updateTimer = null;

        Logger.LogWarning("[vultstrike] cancelling match before live start: {Reason}", reason);
        Server.ExecuteCommand("say [VultStrike] Match cancelled: missing players before live start.");

        _ = Task.Run(async () =>
        {
            await PostScoreUpdate(0, 0, 0, 0);
            await PostResult(0, 0, "DRAW", rated: false, endReason: "NO_SHOW");
            await PostPlayerStats();
        });

        AddTimer(5.0f, () =>
        {
            Logger.LogInformation("[vultstrike] shutting down server after no-show cancellation");
            Server.ExecuteCommand("quit");
        }, TimerFlags.STOP_ON_MAPCHANGE);
    }

    private static bool IsWarmupEvent(object evt)
    {
        try
        {
            var type = evt.GetType();
            var prop = type.GetProperty("IsWarmup")
                       ?? type.GetProperty("Warmup")
                       ?? type.GetProperty("IsWarmupPeriod")
                       ?? type.GetProperty("WarmupPeriod");
            if (prop?.GetValue(evt) is bool b) return b;
        }
        catch
        {
            // ignore reflection errors
        }
        return false;
    }

    private bool IsWarmupPhase(object evt)
    {
        return _inWarmup || IsWarmupEvent(evt) || IsWarmupFromServer();
    }

    private bool IsWarmupFromServer()
    {
        try
        {
            var serverType = typeof(Server);
            var gameRulesProp = serverType.GetProperty("GameRules", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            var gameRules = gameRulesProp?.GetValue(null);
            if (gameRules == null) return false;
            var grType = gameRules.GetType();
            var prop = grType.GetProperty("WarmupPeriod")
                       ?? grType.GetProperty("IsWarmupPeriod")
                       ?? grType.GetProperty("IsWarmup")
                       ?? grType.GetProperty("Warmup");
            if (prop?.GetValue(gameRules) is bool b) return b;
        }
        catch
        {
            // ignore reflection errors
        }
        return false;
    }

    private void RecordSideSwapIfNeeded()
    {
        if (_swapRecorded) return;
        if (_currentRound < SideSwapRound) return;
        _swapRecorded = true;
        _sidesSwapped = true;
        _ctScoreAtSwap = _ctScore;
        _tScoreAtSwap = _tScore;
        Logger.LogInformation("[vultstrike] sides swapped after round {Round} (ct={CT}, t={T})", _currentRound, _ctScoreAtSwap, _tScoreAtSwap);
    }

    private string GetSteamIdString(CCSPlayerController player)
    {
        try
        {
            var authorized = player.AuthorizedSteamID;
            if (authorized != null && authorized.SteamId64 != 0)
            {
                return authorized.SteamId64.ToString();
            }
        }
        catch
        {
            // ignore authorization lookup errors
        }

        try
        {
            var steamId = player.SteamID;
            if (steamId != 0)
            {
                return steamId.ToString();
            }
        }
        catch
        {
            // ignore steamid errors
        }

        return player.SteamID.ToString();
    }

    private void ResetStatsAndPost()
    {
        _playerStats.Clear();
        _ = Task.Run(async () => await PostPlayerStats());
    }

    private void ScheduleInitialTeamAssignment(CCSPlayerController player, string steamId, string team)
    {
        if (_teamLocked.Contains(steamId)) return;
        if (_teamEnforceTimers.ContainsKey(steamId)) return;

        var desiredTeamId = GetDesiredTeamId(team);
        var attempts = 0;
        var timer = AddTimer(TeamAssignIntervalSeconds, () =>
        {
            if (!player.IsValid)
            {
                if (_teamEnforceTimers.TryGetValue(steamId, out var t))
                {
                    t.Kill();
                    _teamEnforceTimers.Remove(steamId);
                }
                return;
            }

            var currentTeamId = GetPlayerTeamId(player);
            if (currentTeamId == desiredTeamId)
            {
                _teamLocked.Add(steamId);
                if (_teamEnforceTimers.TryGetValue(steamId, out var t))
                {
                    t.Kill();
                    _teamEnforceTimers.Remove(steamId);
                }
                return;
            }

            if (_lastTeamEnforceAt.TryGetValue(steamId, out var lastAt) &&
                (DateTime.UtcNow - lastAt).TotalSeconds < TeamAssignIntervalSeconds)
            {
                return;
            }

            _lastTeamEnforceAt[steamId] = DateTime.UtcNow;
            EnsureTeamAssignment(player, team);
            TrySetAlphaStart(player, steamId);
            attempts++;

            if (attempts >= TeamAssignMaxAttempts)
            {
                // Avoid infinite re-scheduling loops if team assignment is blocked by the server.
                // After initial attempts, rely on OnPlayerTeam events + cooldown enforcement.
                _teamLocked.Add(steamId);
                if (_teamEnforceTimers.TryGetValue(steamId, out var t))
                {
                    t.Kill();
                    _teamEnforceTimers.Remove(steamId);
                }
            }
        }, TimerFlags.STOP_ON_MAPCHANGE | TimerFlags.REPEAT);

        _teamEnforceTimers[steamId] = timer;
    }

    private bool NeedsTeamEnforcement(CCSPlayerController player, string team)
    {
        var desiredTeamId = GetDesiredTeamId(team);
        var currentTeamId = GetPlayerTeamId(player);
        if (currentTeamId == null) return true;
        return currentTeamId != desiredTeamId;
    }

    private void EnforceTeamImmediate(CCSPlayerController player, string steamId, string team)
    {
        if (!NeedsTeamEnforcement(player, team))
        {
            _teamLocked.Add(steamId);
            return;
        }

        if (_lastTeamEnforceAt.TryGetValue(steamId, out var lastAt))
        {
            if ((DateTime.UtcNow - lastAt).TotalSeconds < TeamChangeCooldownSeconds)
            {
                return;
            }
        }

        _lastTeamEnforceAt[steamId] = DateTime.UtcNow;
        EnsureTeamAssignment(player, team);
        TrySetAlphaStart(player, steamId);
        var desiredTeamId = GetDesiredTeamId(team);
        var currentTeamId = GetPlayerTeamId(player);
        if (currentTeamId == desiredTeamId)
        {
            _teamLocked.Add(steamId);
        }
    }

    private void KickUnauthorizedConnectedPlayers()
    {
        if (!_authorizedPlayersLoaded || _allowUnknownPlayers) return;
        try
        {
            foreach (var player in Utilities.GetPlayers())
            {
                if (player == null || !player.IsValid) continue;
                if (AllowBots && IsBotPlayer(player)) continue;
                var steamId = GetSteamIdString(player);
                if (string.IsNullOrEmpty(steamId)) continue;
                if (_authorizedSteamIds.Contains(steamId)) continue;
                Logger.LogWarning("[vultstrike] Unauthorized player connected after roster load: {Name} ({SteamId}) - Kicking", player.PlayerName, steamId);
                player.ExecuteClientCommand("disconnect");
                Server.ExecuteCommand($"kickid {player.UserId} \"You are not registered for this match\"");
            }
        }
        catch (Exception e)
        {
            Logger.LogDebug(e, "[vultstrike] failed to kick unauthorized connected players");
        }
    }

    private static bool IsBotPlayer(CCSPlayerController player)
    {
        try
        {
            var prop = player.GetType().GetProperty("IsBot") ?? player.GetType().GetProperty("Isbot");
            if (prop?.GetValue(player) is bool b) return b;
        }
        catch
        {
            // ignore bot detection errors
        }
        return false;
    }

    private void TrySetAlphaStart(CCSPlayerController player, string steamId)
    {
        if (_alphaStartsCt != null) return;
        if (!_teamBySteamId.TryGetValue(steamId, out var team))
        {
            if (_alphaSteamId != null && _alphaSteamId == steamId)
            {
                team = "ALPHA";
            }
            else
            {
                return;
            }
        }

        var teamId = GetPlayerTeamId(player);
        if (teamId != 2 && teamId != 3) return;

        var isCt = teamId == 3;
        _alphaStartsCt = team.Equals("ALPHA", StringComparison.OrdinalIgnoreCase) ? isCt : !isCt;
        Logger.LogInformation("[vultstrike] alpha starts on {Side} (steamId={SteamId})", _alphaStartsCt == true ? "CT" : "T", steamId);
    }

    [GameEventHandler]
    public HookResult OnPlayerSpawn(EventPlayerSpawn @event, GameEventInfo info)
    {
        var player = @event.Userid;
        if (player == null || !player.IsValid) return HookResult.Continue;

        if (_alphaStartsCt == null)
        {
            var steamId = GetSteamIdString(player);
            if (!string.IsNullOrEmpty(steamId))
            {
                TrySetAlphaStart(player, steamId);
            }
        }

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnPlayerTeam(EventPlayerTeam @event, GameEventInfo info)
    {
        var player = @event.Userid;
        if (player == null || !player.IsValid) return HookResult.Continue;

        var steamId = GetSteamIdString(player);
        if (!string.IsNullOrEmpty(steamId) && _teamBySteamId.TryGetValue(steamId, out var team))
        {
            var desiredTeamId = GetDesiredTeamId(team);
            var currentTeamId = GetPlayerTeamId(player);
            if (currentTeamId == desiredTeamId)
            {
                _teamLocked.Add(steamId);
                return HookResult.Continue;
            }

            if (!_teamLocked.Contains(steamId))
            {
                // Initial assignment retry if they landed on the wrong team.
                ScheduleInitialTeamAssignment(player, steamId, team);
                return HookResult.Continue;
            }

            // Prevent team switching after the initial lock.
            EnforceTeamImmediate(player, steamId, team);
        }

        return HookResult.Continue;
    }
    
    private readonly HashSet<string> _authorizedSteamIds = new();
    private bool _authorizedPlayersLoaded = false;
    private bool _allowUnknownPlayers = false;

    public override void Load(bool hotReload)
    {
        Logger.LogInformation("[vultstrike] reporter loaded (matchId={MatchId}, webhook={Webhook}, targetWins={TargetWins}, expectedPlayers={ExpectedPlayers})", MatchId, WebhookUrl, TargetWins, ExpectedPlayers);
        Logger.LogInformation("[vultstrike] env: VS_API_BASE={ApiBase}, VS_WEBHOOK_SECRET={SecretLen}chars, VS_SIDE_SWAP_ROUND={SwapRound}",
            string.IsNullOrWhiteSpace(ApiBaseUrl) ? "(MISSING)" : ApiBaseUrl,
            WebhookSecret?.Length ?? 0,
            SideSwapRound);
        _tScore = 0;
        _ctScore = 0;
        _currentRound = 0;
        _matchStartTime = DateTime.UtcNow;
        // Enforce critical server variables on load
        Server.ExecuteCommand("sv_cheats 0");
        Server.ExecuteCommand("sv_pure 1");
        Server.ExecuteCommand("sv_pure_kick_clients 1");
        // Disable auto team balance to keep assigned sides stable
        Server.ExecuteCommand("mp_autoteambalance 0");
        Server.ExecuteCommand("mp_limitteams 1");
        if (AllowBots)
        {
            Server.ExecuteCommand($"bot_quota {BotQuota}");
            Server.ExecuteCommand("bot_quota_mode normal");
            Server.ExecuteCommand("bot_join_after_player 1");
            var team = (BotTeam ?? "").Trim().ToUpperInvariant();
            if (team == "CT" || team == "COUNTERTERRORIST")
            {
                Server.ExecuteCommand("bot_join_team CT");
            }
            else if (team == "T" || team == "TERRORIST")
            {
                Server.ExecuteCommand("bot_join_team T");
            }
        }
        else
        {
            Server.ExecuteCommand("bot_quota 0");
            Server.ExecuteCommand("bot_quota_mode normal");
            Server.ExecuteCommand("bot_kick");
        }
        Server.ExecuteCommand("mp_respawn_on_death_ct 1");
        Server.ExecuteCommand("mp_respawn_on_death_t 1");
        Server.ExecuteCommand("mp_warmuptime 180");
        Server.ExecuteCommand("mp_warmup_pausetimer 0");
        Server.ExecuteCommand("mp_warmup_start");
        _inWarmup = true;
        _warmupSeen = true;
        _warmupEnded = false;

        if (string.IsNullOrWhiteSpace(MatchId) || string.IsNullOrWhiteSpace(WebhookUrl) || string.IsNullOrWhiteSpace(WebhookSecret))
        {
            Logger.LogWarning("[vultstrike] VS_MATCH_ID / VS_WEBHOOK_URL / VS_WEBHOOK_SECRET not configured; reporter will be inert.");
            return;
        }

        // Load authorized players for this match
        _ = Task.Run(async () => await LoadAuthorizedPlayers());

        // Start periodic update timer (every 5 seconds)
        _updateTimer = AddTimer(5.0f, SendPeriodicUpdate, TimerFlags.REPEAT);
        Logger.LogInformation("[vultstrike] Started periodic update timer (5s interval)");
    }

    public override void Unload(bool hotReload)
    {
        _updateTimer?.Kill();
        _updateTimer = null;
        _shutdownTimer?.Kill();
        _shutdownTimer = null;
    }

    private void SendPeriodicUpdate()
    {
        if (_matchCancelledForNoShow) return;

        if (_liveStarted)
        {
            EnforceTeamLocksDuringLiveMatch();
        }

        var elapsed = (int)(DateTime.UtcNow - _matchStartTime).TotalSeconds;
        var mapped = MapScoresToTeams(_ctScore, _tScore);
        _ = Task.Run(async () => await PostScoreUpdate(mapped.alpha, mapped.bravo, _currentRound, elapsed));

        if (_liveStarted && (DateTime.UtcNow - _lastStatsSentAt).TotalSeconds >= StatsIntervalSeconds)
        {
            _lastStatsSentAt = DateTime.UtcNow;
            _ = Task.Run(async () => await PostPlayerStats());
        }
    }

    [GameEventHandler]
    public HookResult OnPlayerConnect(EventPlayerConnect @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        var player = @event.Userid;
        if (player == null || !player.IsValid) return HookResult.Continue;

        var steamId = GetSteamIdString(player);
        var name = player.PlayerName;
        var isBot = AllowBots && IsBotPlayer(player);

        // Verify player is authorized for this match
        if (!isBot && _authorizedPlayersLoaded && !_allowUnknownPlayers && IsValidSteamIdForMatch(steamId))
        {
            if (!_authorizedSteamIds.Contains(steamId))
            {
                Logger.LogWarning("[vultstrike] Unauthorized player attempted to connect: {Name} ({SteamId}) - Kicking", name, steamId);
                player.ExecuteClientCommand("disconnect");
                Server.ExecuteCommand($"kickid {player.UserId} \"You are not registered for this match\"");
                return HookResult.Handled;
            }
        }

        // Track connected players
        if (!isBot && IsValidSteamIdForMatch(steamId))
        {
            _connectedPlayers.Add(steamId);

            // Infer which side ALPHA started on (CT/T) based on the first known team connection
            TrySetAlphaStart(player, steamId);
            if (_teamBySteamId.TryGetValue(steamId, out var team))
            {
                // Avoid heavy enforcement during initial connect; wait for full connect/spawn.
                if (_alphaStartsCt == null)
                {
                    TrySetAlphaStart(player, steamId);
                }
            }
            if (_alphaStartsCt == null)
            {
                AddTimer(2.0f, () =>
                {
                    if (player.IsValid)
                    {
                        TrySetAlphaStart(player, steamId);
                    }
                }, TimerFlags.STOP_ON_MAPCHANGE);
            }
            
            TryShortenWarmupIfReady();
        }

        Logger.LogInformation("[vultstrike] player connected: {Name} ({SteamId}), total players: {Count}", name, steamId, _connectedPlayers.Count);
        _ = Task.Run(async () => await PostPlayerEvent(steamId, name, "connected"));

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnPlayerConnectFull(EventPlayerConnectFull @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        var player = @event.Userid;
        if (player == null || !player.IsValid) return HookResult.Continue;

        var steamId = GetSteamIdString(player);
        var name = player.PlayerName;
        var isBot = AllowBots && IsBotPlayer(player);

        // Track connected players and infer side mapping if needed
        if (!isBot && IsValidSteamIdForMatch(steamId))
        {
            _connectedPlayers.Add(steamId);
            TrySetAlphaStart(player, steamId);
            if (_teamBySteamId.TryGetValue(steamId, out var team))
            {
                if (!_liveStarted)
                {
                    ScheduleInitialTeamAssignment(player, steamId, team);
                }
                else
                {
                    EnforceTeamImmediate(player, steamId, team);
                }
            }
            if (_alphaStartsCt == null)
            {
                AddTimer(2.0f, () =>
                {
                    if (player.IsValid)
                    {
                        TrySetAlphaStart(player, steamId);
                    }
                }, TimerFlags.STOP_ON_MAPCHANGE);
            }
            TryShortenWarmupIfReady();
        }

        Logger.LogInformation("[vultstrike] player connect full: {Name} ({SteamId})", name, steamId);
        _ = Task.Run(async () => await PostPlayerEvent(steamId, name, "connected"));
        if (!AllowBots)
        {
            Server.ExecuteCommand("bot_kick");
        }

        return HookResult.Continue;
    }


    [GameEventHandler]
    public HookResult OnPlayerDisconnect(EventPlayerDisconnect @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        var player = @event.Userid;
        if (player == null || !player.IsValid) return HookResult.Continue;

        var steamId = GetSteamIdString(player);
        var name = player.PlayerName;
        var isBot = AllowBots && IsBotPlayer(player);

        Logger.LogInformation("[vultstrike] player disconnected: {Name} ({SteamId})", name, steamId);
        _ = Task.Run(async () => await PostPlayerEvent(steamId, name, "disconnected"));

        // Remove from connected players set
        if (!isBot && IsValidSteamIdForMatch(steamId))
        {
            _connectedPlayers.Remove(steamId);
            if (_teamEnforceTimers.TryGetValue(steamId, out var timer))
            {
                timer.Kill();
                _teamEnforceTimers.Remove(steamId);
            }
            _teamLocked.Remove(steamId);
            _lastTeamEnforceAt.Remove(steamId);
        }

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnPlayerDeath(EventPlayerDeath @event, GameEventInfo info)
    {
        if (!_liveStarted || _inWarmup)
        {
            return HookResult.Continue;
        }
        var victim = @event.Userid;
        var attacker = @event.Attacker;
        var assister = @event.Assister;

        if (victim == null || !victim.IsValid) return HookResult.Continue;

        var victimSteamId = GetSteamIdString(victim);
        var victimName = victim.PlayerName;

        // Track victim death
        if (!_playerStats.ContainsKey(victimSteamId))
        {
            _playerStats[victimSteamId] = new PlayerStats 
            { 
                SteamId = victimSteamId, 
                Name = victimName 
            };
        }
        _playerStats[victimSteamId].Deaths++;

        // Track attacker kill
        if (attacker != null && attacker.IsValid && attacker.SteamID != victim.SteamID)
        {
            var attackerSteamId = GetSteamIdString(attacker);
            var attackerName = attacker.PlayerName;

            if (!_playerStats.ContainsKey(attackerSteamId))
            {
                _playerStats[attackerSteamId] = new PlayerStats 
                { 
                    SteamId = attackerSteamId, 
                    Name = attackerName 
                };
            }
            _playerStats[attackerSteamId].Kills++;

            // Track damage (approximate)
            _playerStats[attackerSteamId].Damage += @event.DmgHealth;
        }

        // Track assister
        if (assister != null && assister.IsValid && assister.SteamID != victim.SteamID)
        {
            var assisterSteamId = GetSteamIdString(assister);
            var assisterName = assister.PlayerName;

            if (!_playerStats.ContainsKey(assisterSteamId))
            {
                _playerStats[assisterSteamId] = new PlayerStats 
                { 
                    SteamId = assisterSteamId, 
                    Name = assisterName 
                };
            }
            _playerStats[assisterSteamId].Assists++;
        }

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnRoundEnd(EventRoundEnd @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        var winner = @event.Winner;
        
        Logger.LogInformation("[vultstrike] round {Round} ended, winner team: {Winner}, score: CT {CT} - T {T}", 
            _currentRound, winner, _ctScore, _tScore);

        if (IsWarmupPhase(@event))
        {
            _warmupSeen = true;
            return HookResult.Continue;
        }

        if (!_liveStarted)
        {
            if (_warmupSeen && !_warmupEnded)
            {
                return HookResult.Continue;
            }
            if (winner == 2 || winner == 3)
            {
                StartLiveMatch("round end");
            }
            if (!_liveStarted)
            {
                return HookResult.Continue;
            }
        }

        // If team_score events don't fire, update score based on round winner.
        if (winner == 2 || winner == 3)
        {
            if (!_scoreUpdatedThisRound)
            {
                if (winner == 2)
                {
                    _tScoreRaw++;
                    _tScore = _tScoreOffset + _tScoreRaw;
                }
                if (winner == 3)
                {
                    _ctScoreRaw++;
                    _ctScore = _ctScoreOffset + _ctScoreRaw;
                }

                _currentRound = Math.Max(_currentRound, _tScore + _ctScore);
                RecordSideSwapIfNeeded();

                var elapsed = (int)(DateTime.UtcNow - _matchStartTime).TotalSeconds;
                var mapped = MapScoresToTeams(_ctScore, _tScore);
                _ = Task.Run(async () => await PostScoreUpdate(mapped.alpha, mapped.bravo, _currentRound, elapsed));
                _scoreUpdatedThisRound = true;
            }
        }
        else
        {
            if (_liveStarted)
            {
                _currentRound = Math.Max(_currentRound, _tScore + _ctScore);
            }
        }

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnTeamScore(EventTeamScore @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        try
        {
            var teamId = @event.Teamid;
            var score = @event.Score;

            if (IsWarmupPhase(@event))
            {
                _warmupSeen = true;
                return HookResult.Continue;
            }

            if (!_liveStarted)
            {
                if (_warmupSeen && !_warmupEnded)
                {
                    return HookResult.Continue;
                }
                if (teamId == 2 || teamId == 3)
                {
                    StartLiveMatch("team score");
                }
                if (!_liveStarted)
                {
                    return HookResult.Continue;
                }
            }

            if (teamId == 2)
            {
                if (score < _tScoreRaw && _tScoreRaw > 0)
                {
                    _tScoreOffset += _tScoreRaw;
                }
                _tScoreRaw = score;
                _tScore = _tScoreOffset + _tScoreRaw;
            }
            if (teamId == 3)
            {
                if (score < _ctScoreRaw && _ctScoreRaw > 0)
                {
                    _ctScoreOffset += _ctScoreRaw;
                }
                _ctScoreRaw = score;
                _ctScore = _ctScoreOffset + _ctScoreRaw;
            }
            _scoreUpdatedThisRound = true;

            Logger.LogInformation("[vultstrike] team score update: team {TeamId} = {Score}, current: CT {CT} - T {T}", 
                teamId, score, _ctScore, _tScore);

            _currentRound = Math.Max(_currentRound, _tScore + _ctScore);
            RecordSideSwapIfNeeded();

            // Send score update after team score changes
            var elapsed = (int)(DateTime.UtcNow - _matchStartTime).TotalSeconds;
            var mapped = MapScoresToTeams(_ctScore, _tScore);
            _ = Task.Run(async () => await PostScoreUpdate(mapped.alpha, mapped.bravo, _currentRound, elapsed));
        }
        catch (Exception e)
        {
            Logger.LogWarning(e, "[vultstrike] failed to parse team_score event");
        }

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnRoundStart(EventRoundStart @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        _scoreUpdatedThisRound = false;
        if (IsWarmupPhase(@event))
        {
            _warmupSeen = true;
            Logger.LogInformation("[vultstrike] warmup round start detected");
            return HookResult.Continue;
        }
        if (!_liveStarted)
        {
            if (_warmupSeen && !_warmupEnded)
            {
                return HookResult.Continue;
            }

            StartLiveMatch("round start");
            _ = Task.Run(async () => await PostScoreUpdate(0, 0, 0, 0));
            return HookResult.Continue;
        }

        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnRoundAnnounceWarmup(EventRoundAnnounceWarmup @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        _inWarmup = true;
        _warmupSeen = true;
        Logger.LogInformation("[vultstrike] warmup announced");
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnWarmupEnd(EventWarmupEnd @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        _inWarmup = false;
        _warmupSeen = true;
        if (_warmupEnded)
        {
            return HookResult.Continue;
        }
        _warmupEnded = true;
        if (!_liveStarted)
        {
            if (!HasConnectedPlayersForBothSides())
            {
                CancelMatchForNoShow($"connected={_connectedPlayers.Count}, expected={ExpectedPlayers}");
                return HookResult.Continue;
            }
            StartLiveMatch("warmup end");
            _ = Task.Run(async () => await PostScoreUpdate(0, 0, 0, 0));
        }
        return HookResult.Continue;
    }

    [GameEventHandler]
    public HookResult OnMatchWinPanel(EventCsWinPanelMatch @event, GameEventInfo info)
    {
        if (_matchCancelledForNoShow) return HookResult.Continue;

        var ct = _ctScore;
        var t = _tScore;
        _currentRound = Math.Max(_currentRound, ct + t);
        RecordSideSwapIfNeeded();
        var mapped = MapScoresToTeams(ct, t);

        // Get final scores from event if available, otherwise use tracked scores
        var winner = mapped.alpha > mapped.bravo ? "ALPHA" : mapped.bravo > mapped.alpha ? "BRAVO" : "DRAW";
        Logger.LogInformation("[vultstrike] match end detected (ct={CT}, t={T}, winner={Winner})", ct, t, winner);

        _updateTimer?.Kill();
        _updateTimer = null;

        // Send final score update with player stats
        var elapsed = (int)(DateTime.UtcNow - _matchStartTime).TotalSeconds;
        _ = Task.Run(async () => 
        {
            await PostScoreUpdate(mapped.alpha, mapped.bravo, _currentRound, elapsed);
            await PostResult(mapped.alpha, mapped.bravo, winner);
            await PostPlayerStats();
        });

        // The API is responsible for stopping/removing the Docker container.
        // Auto-shutdown can be enabled for belt-and-suspenders, but is disabled by default.
        if (AutoShutdownEnabled)
        {
            Logger.LogInformation("[vultstrike] scheduling server shutdown in {Delay}s", ShutdownDelaySeconds);
            _shutdownTimer = AddTimer(ShutdownDelaySeconds, () =>
            {
                Logger.LogInformation("[vultstrike] shutting down server after match completion");
                Server.ExecuteCommand("quit");
            });
        }
        else
        {
            Logger.LogInformation("[vultstrike] server auto-shutdown disabled (set VS_AUTO_SHUTDOWN=1 to enable)");
        }

        return HookResult.Continue;
    }

    private async Task PostScoreUpdate(int ctScore, int tScore, int round, int elapsed)
    {
        if (string.IsNullOrWhiteSpace(MatchId) || string.IsNullOrWhiteSpace(WebhookUrl) || string.IsNullOrWhiteSpace(WebhookSecret))
            return;

        try
        {
            var updateUrl = WebhookUrl.Replace("/result", "/score");
            var payloadObj = new
            {
                matchId = MatchId,
                score = new { alpha = ctScore, bravo = tScore },
                currentRound = round,
                durationSeconds = elapsed
            };

            await SendWebhook(updateUrl, payloadObj);
        }
        catch (Exception e)
        {
            Logger.LogWarning(e, "[vultstrike] score update error (url={Url})", WebhookUrl.Replace("/result", "/score"));
        }
    }

    private async Task PostPlayerEvent(string steamId, string name, string eventType)
    {
        if (string.IsNullOrWhiteSpace(MatchId) || string.IsNullOrWhiteSpace(WebhookUrl) || string.IsNullOrWhiteSpace(WebhookSecret))
            return;

        try
        {
            var playerUrl = WebhookUrl.Replace("/result", "/player");
            var payloadObj = new
            {
                matchId = MatchId,
                steamId,
                handle = name,
                @event = eventType,
                at = DateTimeOffset.UtcNow.ToUnixTimeSeconds()
            };

            await SendWebhook(playerUrl, payloadObj);
        }
        catch (Exception e)
        {
            Logger.LogWarning(e, "[vultstrike] player event error (steamId={SteamId}, event={Event}, url={Url})", steamId, eventType, WebhookUrl.Replace("/result", "/player"));
        }
    }

    private async Task PostResult(int ctScore, int tScore, string winner, bool rated = true, string? endReason = null)
    {
        if (string.IsNullOrWhiteSpace(MatchId) || string.IsNullOrWhiteSpace(WebhookUrl) || string.IsNullOrWhiteSpace(WebhookSecret))
            return;

        try
        {
            var payloadObj = new
            {
                matchId = MatchId,
                score = new[] { ctScore, tScore },
                winner,
                rated,
                endReason
            };

            await SendWebhook(WebhookUrl, payloadObj);
            Logger.LogInformation("[vultstrike] match result posted successfully");
        }
        catch (Exception e)
        {
            Logger.LogWarning(e, "[vultstrike] match result post error");
        }
    }

    private async Task PostPlayerStats()
    {
        if (string.IsNullOrWhiteSpace(MatchId) || string.IsNullOrWhiteSpace(WebhookUrl) || string.IsNullOrWhiteSpace(WebhookSecret))
            return;

        try
        {
            var statsUrl = WebhookUrl.Replace("/result", "/stats");
            var players = _playerStats.Values.Select(p => new
            {
                steamId = p.SteamId,
                name = p.Name,
                kills = p.Kills,
                deaths = p.Deaths,
                assists = p.Assists,
                damage = p.Damage
            }).ToList();

            var payloadObj = new
            {
                matchId = MatchId,
                players
            };

            await SendWebhook(statsUrl, payloadObj);
            Logger.LogInformation("[vultstrike] player stats posted successfully ({Count} players)", players.Count);
        }
        catch (Exception e)
        {
            Logger.LogWarning(e, "[vultstrike] player stats post error (url={Url})", WebhookUrl.Replace("/result", "/stats"));
        }
    }

    private async Task LoadAuthorizedPlayers()
    {
        if (string.IsNullOrWhiteSpace(MatchId) || string.IsNullOrWhiteSpace(ApiBaseUrl))
        {
            Logger.LogWarning("[vultstrike] Cannot load authorized players: MatchId or ApiBaseUrl not configured");
            _allowUnknownPlayers = AllowUnknownPlayersFallback;
            if (_allowUnknownPlayers)
            {
                Logger.LogWarning("[vultstrike] VS_ALLOW_UNKNOWN_PLAYERS=1; allowing unknown players.");
            }
            else
            {
                Logger.LogError("[vultstrike] Roster config missing and fallback disabled. Match will fail closed.");
            }
            _authorizedPlayersLoaded = true;
            return;
        }

        var loadedAny = false;
        try
        {
            var url = $"{ApiBaseUrl.TrimEnd('/')}/matches/{MatchId}/players";
            Logger.LogInformation("[vultstrike] Loading authorized players from {Url}", url);

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            var resp = await Http.SendAsync(req);

            if (resp.IsSuccessStatusCode)
            {
                var content = await resp.Content.ReadAsStringAsync();
                var players = JsonSerializer.Deserialize<List<Dictionary<string, object>>>(content);

                if (players != null)
                {
                    foreach (var player in players)
                    {
                        if (player.TryGetValue("steamId", out var steamIdObj) && steamIdObj != null)
                        {
                            var steamId = steamIdObj.ToString();
                            if (!string.IsNullOrEmpty(steamId))
                            {
                                _authorizedSteamIds.Add(steamId);
                                if (player.TryGetValue("team", out var teamObj) && teamObj != null)
                                {
                                    var team = teamObj.ToString() ?? "";
                                    if (!string.IsNullOrEmpty(team))
                                    {
                                        _teamBySteamId[steamId] = team;
                                        if (team.Equals("ALPHA", StringComparison.OrdinalIgnoreCase))
                                        {
                                            _alphaSteamId = steamId;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Logger.LogInformation("[vultstrike] Loaded {Count} authorized players for match {MatchId}", _authorizedSteamIds.Count, MatchId);
                if (_authorizedSteamIds.Count == 0 || _teamBySteamId.Count == 0)
                {
                    loadedAny = await LoadAuthorizedPlayersFromMatchDetails() || _authorizedSteamIds.Count > 0;
                }
                else
                {
                    loadedAny = true;
                }
            }
            else
            {
                Logger.LogWarning("[vultstrike] Failed to load authorized players: HTTP {Status}. Falling back to match details.", (int)resp.StatusCode);
                loadedAny = await LoadAuthorizedPlayersFromMatchDetails();
            }
        }
        catch (Exception e)
        {
            Logger.LogError(e, "[vultstrike] Error loading authorized players");
            loadedAny = await LoadAuthorizedPlayersFromMatchDetails();
        }
        finally
        {
            if (!loadedAny)
            {
                _allowUnknownPlayers = AllowUnknownPlayersFallback;
                if (_allowUnknownPlayers)
                {
                    Logger.LogWarning("[vultstrike] Authorized roster unavailable; allowing any player for match {MatchId} (fallback enabled)", MatchId);
                }
                else
                {
                    Logger.LogError("[vultstrike] Authorized roster unavailable for match {MatchId}; enforcing fail-closed mode.", MatchId);
                }
            }
            _authorizedPlayersLoaded = true;
            if (!_allowUnknownPlayers)
            {
                AddTimer(1.0f, () => KickUnauthorizedConnectedPlayers(), TimerFlags.STOP_ON_MAPCHANGE);
            }
            AddTimer(1.0f, () => TryShortenWarmupIfReady(), TimerFlags.STOP_ON_MAPCHANGE);
        }
    }

    private async Task<bool> LoadAuthorizedPlayersFromMatchDetails()
    {
        try
        {
            var url = $"{ApiBaseUrl.TrimEnd('/')}/matches/{MatchId}";
            Logger.LogInformation("[vultstrike] Loading match details from {Url}", url);
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            var resp = await Http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
            {
                Logger.LogWarning("[vultstrike] Failed to load match details: HTTP {Status}", (int)resp.StatusCode);
                return false;
            }

            var content = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(content);
            if (!doc.RootElement.TryGetProperty("teams", out var teams))
            {
                Logger.LogWarning("[vultstrike] Match details missing teams");
                return false;
            }

            var added = 0;
            foreach (var teamName in new[] { "alpha", "bravo" })
            {
                if (!teams.TryGetProperty(teamName, out var teamPlayers) || teamPlayers.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }
                foreach (var player in teamPlayers.EnumerateArray())
                {
                    if (!player.TryGetProperty("steamId", out var steamIdProp)) continue;
                    var steamId = steamIdProp.GetString();
                    if (string.IsNullOrEmpty(steamId)) continue;
                    _authorizedSteamIds.Add(steamId);
                    added++;
                    var team = teamName.ToUpperInvariant();
                    _teamBySteamId[steamId] = team;
                    if (team == "ALPHA")
                    {
                        _alphaSteamId = steamId;
                    }
                }
            }

            Logger.LogInformation("[vultstrike] Loaded {Count} authorized players from match details for {MatchId}", _authorizedSteamIds.Count, MatchId);
            return added > 0;
        }
        catch (Exception e)
        {
            Logger.LogError(e, "[vultstrike] Error loading match details");
            return false;
        }
    }

    private async Task SendWebhook(string url, object payload)
    {
        var body = JsonSerializer.Serialize(payload);
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        var signedPayload = $"{timestamp}.{body}";
        var sig = HmacSha256Hex(WebhookSecret, signedPayload);

        using var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        req.Headers.TryAddWithoutValidation("x-vultstrike-timestamp", timestamp);
        req.Headers.TryAddWithoutValidation("x-vultstrike-signature", $"sha256={sig}");

        var resp = await Http.SendAsync(req);
        
        if (!resp.IsSuccessStatusCode)
        {
            var respText = await resp.Content.ReadAsStringAsync();
            Logger.LogWarning("[vultstrike] webhook FAILED: {Method} {Url} -> {Status} {Body}", req.Method, url, (int)resp.StatusCode, respText);
        }
        else
        {
            Logger.LogInformation("[vultstrike] webhook OK: {Method} {Url} -> {Status}", req.Method, url, (int)resp.StatusCode);
        }
    }

    private static string HmacSha256Hex(string secret, string payload)
    {
        var key = Encoding.UTF8.GetBytes(secret);
        using var hmac = new HMACSHA256(key);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }
}
