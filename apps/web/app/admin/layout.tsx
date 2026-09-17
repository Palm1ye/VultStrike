import { Metadata } from "next";

export const metadata: Metadata = {
  // Keep the route out of search results, but avoid "Admin" labeling in previews.
  robots: "noindex, nofollow"
};

export const revalidate = 0;

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
