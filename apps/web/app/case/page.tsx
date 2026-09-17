import type { Metadata } from "next";
import { CaseOpeningLab } from "@/components/case-opening-lab";

export const metadata: Metadata = {
  title: "Case Lab | VultStrike",
  description: "Private VultStrike case-opening animation playground.",
  robots: {
    index: false,
    follow: false
  }
};

export default function CasePage() {
  return <CaseOpeningLab />;
}
