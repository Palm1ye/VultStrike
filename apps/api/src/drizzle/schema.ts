import { pgTable, serial, varchar, integer, timestamp, pgEnum, boolean, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const roleEnum = pgEnum('role', ['ADMIN', 'MODERATOR', 'USER']);
export const matchStatusEnum = pgEnum('match_status', ['PENDING', 'IN_PROGRESS', 'FINISHED']);
export const serverStatusEnum = pgEnum('server_status', ['PENDING', 'PULLING_IMAGE', 'STARTING', 'READY', 'FAILED']);
export const queueModeEnum = pgEnum('queue_mode', ['ONE_V_ONE', 'TWO_V_TWO', 'THREE_V_THREE']);
export const queueStatusEnum = pgEnum('queue_status', ['ENQUEUED', 'MATCHED', 'CANCELLED']);

export const user = pgTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  handle: varchar('handle', { length: 32 }).notNull(),
  displayName: varchar('display_name', { length: 64 }),
  email: varchar('email', { length: 128 }),
  steamId: varchar('steam_id', { length: 32 }),
  trustScore: integer('trust_score'),
  role: roleEnum('role').notNull(),
  // Economy
  credits: integer('credits').default(0),
  mmr1v1: integer('mmr_1v1'),
  mmr2v2: integer('mmr_2v2'),
  mmr3v3: integer('mmr_3v3'),
  placementMatches1v1: integer('placement_matches_1v1').default(0),
  placementMatches2v2: integer('placement_matches_2v2').default(0),
  placementMatches3v3: integer('placement_matches_3v3').default(0),
  placementWins1v1: integer('placement_wins_1v1').default(0),
  placementWins2v2: integer('placement_wins_2v2').default(0),
  placementWins3v3: integer('placement_wins_3v3').default(0),
  banned: boolean('banned').default(false),
  banReason: varchar('ban_reason', { length: 256 }),
  banUntil: timestamp('ban_until'),
  // Profile customization
  profileTheme: varchar('profile_theme', { length: 32 }).default('default'),
  profileBorder: varchar('profile_border', { length: 32 }).default('default'),
  profileAvatar: varchar('profile_avatar', { length: 32 }).default('default'),
  profileStatus: varchar('profile_status', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const match = pgTable('match', {
  id: varchar('id', { length: 36 }).primaryKey(),
  lobbyCode: varchar('lobby_code', { length: 32 }),
  mode: queueModeEnum('mode').notNull(),
  map: varchar('map', { length: 128 }),
  status: matchStatusEnum('status').notNull(),
  serverStatus: serverStatusEnum('server_status').default('PENDING'),
  serverEndpoint: varchar('server_endpoint', { length: 64 }),
  containerId: varchar('container_id', { length: 128 }),
  serverError: varchar('server_error', { length: 256 }),
  scoreAlpha: integer('score_alpha').default(0),
  scoreBravo: integer('score_bravo').default(0),
  currentRound: integer('current_round').default(0),
  durationSeconds: integer('duration_seconds').default(0),
  winner: varchar('winner', { length: 16 }),
  mmrDelta: integer('mmr_delta'),
  scoreboard: jsonb('scoreboard'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const matchParticipant = pgTable('match_participant', {
  id: serial('id').primaryKey(),
  matchId: varchar('match_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  team: varchar('team', { length: 16 }),
  side: varchar('side', { length: 16 }),
  ready: boolean('ready'),
  connected: boolean('connected').default(false),
  connectedAt: timestamp('connected_at'),
  // Player stats from game
  kills: integer('kills').default(0),
  assists: integer('assists').default(0),
  deaths: integer('deaths').default(0),
  damage: integer('damage').default(0),
  rating: integer('rating').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const queueTicket = pgTable('queue_ticket', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),
  mode: queueModeEnum('mode').notNull(),
  region: varchar('region', { length: 16 }),
  status: queueStatusEnum('status').notNull(),
  partyId: varchar('party_id', { length: 36 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const party = pgTable('party', {
  id: varchar('id', { length: 36 }).primaryKey(),
  code: varchar('code', { length: 16 }).notNull(),
  leaderUserId: varchar('leader_user_id', { length: 36 }).notNull(),
  mode: queueModeEnum('mode'),
  region: varchar('region', { length: 16 }),
  status: varchar('status', { length: 16 }).default('OPEN'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const partyMember = pgTable('party_member', {
  id: serial('id').primaryKey(),
  partyId: varchar('party_id', { length: 36 }).notNull(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  role: varchar('role', { length: 16 }).default('MEMBER'),
  ready: boolean('ready').default(false),
  joinedAt: timestamp('joined_at').defaultNow(),
});

// Define relations for query builder
export const queueTicketRelations = relations(queueTicket, ({ one }) => ({
  user: one(user, {
    fields: [queueTicket.userId],
    references: [user.id],
  }),
}));

export const userSession = pgTable('user_session', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),
  userAgent: varchar('user_agent', { length: 512 }),
  ipAddress: varchar('ip_address', { length: 64 }),
  country: varchar('country', { length: 64 }),
  city: varchar('city', { length: 128 }),
  lastActiveAt: timestamp('last_active_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userSessionRelations = relations(userSession, ({ one }) => ({
  user: one(user, {
    fields: [userSession.userId],
    references: [user.id],
  }),
}));

export const userBanLog = pgTable('user_ban_log', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  adminId: varchar('admin_id', { length: 36 }),
  action: varchar('action', { length: 16 }).notNull(),
  reason: varchar('reason', { length: 256 }),
  banUntil: timestamp('ban_until'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const matchReport = pgTable('match_report', {
  id: serial('id').primaryKey(),
  matchId: varchar('match_id', { length: 36 }).notNull(),
  reporterUserId: varchar('reporter_user_id', { length: 36 }).notNull(),
  reportedUserId: varchar('reported_user_id', { length: 36 }),
  reportedHandle: varchar('reported_handle', { length: 64 }),
  reason: varchar('reason', { length: 64 }).notNull(),
  details: varchar('details', { length: 1024 }),
  status: varchar('status', { length: 16 }).default('OPEN'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userDrop = pgTable('user_drop', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  source: varchar('source', { length: 32 }).notNull(), // e.g. MATCH_REWARD, CASE_OPEN
  rarity: varchar('rarity', { length: 16 }).notNull(), // COMMON/RARE/EPIC/LEGENDARY
  item: varchar('item', { length: 64 }).notNull(),
  meta: jsonb('meta'),
  createdAt: timestamp('created_at').defaultNow(),
});
