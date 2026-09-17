import { MatchFeed } from "@/components/match-feed";
import { CommunityStatsPanel } from "@/components/community-stats";
import { CommunityTotalsPanel } from "@/components/community-totals";
// import { Shoutbox } from "@/components/shoutbox";

export default function CommunityPage() {
  return (
    <main className="max-w-6xl mx-auto py-12 px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Community feed</h1>
        <p className="text-sm text-zinc-400">Live lobbies and social activity.</p>
      </div>

      <section className="grid lg:grid-cols-[2fr_1fr] gap-6">
        <MatchFeed />
        <div className="space-y-6">
          <CommunityStatsPanel />
          <CommunityTotalsPanel />
        </div>
        {/* <Shoutbox /> */}
      </section>
    </main>
  );
}
