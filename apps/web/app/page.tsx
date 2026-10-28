import type { Metadata } from "next";
import { MainLanding } from "@/components/landing/Main";

export const metadata: Metadata = {
  title: { absolute: "Hirelane: a fair shot at a job, after the campus drives end" },
  description: "Off-campus roles students actually qualify for, and a placement console for universities.",
};

export default function Home() {
  return <MainLanding />;
}
