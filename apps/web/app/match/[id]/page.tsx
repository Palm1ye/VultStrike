import { MatchDashboard } from "@/components/match-dashboard";

export default function MatchPage({ params }: { params: { id: string } }) {
  return (
    <main className="px-4 py-10">
      <div className="mx-auto w-full max-w-5xl">
        <MatchDashboard matchId={params.id} />
      </div>
    </main>
  );
}
