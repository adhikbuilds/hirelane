"use client";

import { useState, type ReactNode } from "react";
import { Briefcase, MapPin, Sparkles } from "lucide-react";
import { CompanyLogo } from "../../../components/brand/CompanyLogo";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { Chip, ChipButton } from "../../../components/ui/Chip";
import { Combobox, type ComboboxOption } from "../../../components/ui/Combobox";
import { CountUp } from "../../../components/ui/CountUp";
import { DropZone } from "../../../components/ui/DropZone";
import { Marquee } from "../../../components/ui/Marquee";
import { MatchRing } from "../../../components/ui/MatchRing";
import { RangeSlider } from "../../../components/ui/RangeSlider";
import { Reveal } from "../../../components/ui/Reveal";
import { SegmentedControl } from "../../../components/ui/SegmentedControl";
import { Select } from "../../../components/ui/Select";
import { Skeleton, SkeletonText } from "../../../components/ui/Skeleton";
import { UndoBar } from "../../../components/ui/UndoBar";

const COMPANIES: ComboboxOption[] = [
  { value: "razorpay", label: "Razorpay", hint: "Fintech", leading: <CompanyLogo name="Razorpay" size={24} /> },
  { value: "stripe", label: "Stripe", hint: "Payments", leading: <CompanyLogo name="Stripe" size={24} /> },
  { value: "swiggy", label: "Swiggy", hint: "Food", leading: <CompanyLogo name="Swiggy" size={24} /> },
  { value: "zepto", label: "Zepto", hint: "Quick commerce", leading: <CompanyLogo name="Zepto" size={24} /> },
  { value: "notion", label: "Notion", hint: "Productivity", leading: <CompanyLogo name="Notion" size={24} /> },
];

const TICKER = [
  ["Razorpay", "Senior Backend Engineer", "2h ago"],
  ["Stripe", "Staff Data Scientist", "3h ago"],
  ["Swiggy", "Product Designer", "5h ago"],
  ["Zepto", "Engineering Manager", "6h ago"],
  ["Notion", "Frontend Engineer", "8h ago"],
  ["Linear", "Infrastructure Engineer", "9h ago"],
] as const;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const id = `h-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="border-t border-line py-10 first:border-t-0">
      <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id={id} className="text-[24px] font-extrabold tracking-[-0.03em]">
          {title}
        </h2>
        {note && <p className="text-[14px] text-ink-3">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const Label = ({ children }: { children: ReactNode }) => <p className="mb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-ink-3">{children}</p>;

export function Gallery() {
  const [period, setPeriod] = useState("monthly");
  const [min, setMin] = useState(70);
  const [role, setRole] = useState("software-engineer-backend");
  const [company, setCompany] = useState<string | null>(null);
  const [score, setScore] = useState(82);
  const [undo, setUndo] = useState<"idle" | "running" | "sent" | "undone">("idle");
  const [file, setFile] = useState<string | null>(null);
  const [filters, setFilters] = useState<string[]>(["remote"]);
  const toggle = (k: string) => setFilters((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]));

  return (
    <div className="hero-mesh">
      <div className="stripe-bg">
        <div className="mx-auto w-full max-w-page px-4 pb-24 pt-12 sm:px-8">
          <header className="mb-4">
            <Chip tone="lane" icon={<Sparkles aria-hidden className="size-3.5" />}>Dev only</Chip>
            <h1 className="mt-4 text-[40px] font-extrabold leading-[44px] tracking-[-0.03em] sm:text-[56px] sm:leading-[58px]">UI kit v2</h1>
            <p className="mt-3 max-w-xl text-ink-2">Every component and state of the Hirelane v2 visual system. This page returns 404 in production.</p>
          </header>

          <Card className="mt-8">
            <Section title="Buttons">
              <div className="flex flex-wrap items-center gap-3">
                <Button>Start free</Button>
                <Button variant="secondary">Pass</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="signal">Needs you</Button>
                <Button variant="danger">Remove</Button>
                <Button disabled>Disabled</Button>
                <Button loading>Saving</Button>
                <Button size="sm">Small</Button>
                <Button size="lg" icon={<Briefcase aria-hidden className="size-5" />}>Approve and send</Button>
              </div>
            </Section>

            <Section title="Chips" note="Static labels and filter toggles with counts.">
              <div className="flex flex-wrap gap-2">
                <Chip>Neutral</Chip>
                <Chip tone="lane">Lane</Chip>
                <Chip tone="signal">Needs you</Chip>
                <Chip tone="match">3 matched</Chip>
                <Chip tone="miss">1 missing</Chip>
                <Chip tone="info" icon={<MapPin aria-hidden className="size-3.5" />}>Bengaluru</Chip>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  ["remote", "Remote", 5208],
                  ["salary", "Salary shown", 10663],
                  ["senior", "Senior", 3317],
                ].map(([k, l, n]) => (
                  <ChipButton key={k as string} selected={filters.includes(k as string)} count={n as number} onClick={() => toggle(k as string)}>
                    {l}
                  </ChipButton>
                ))}
                <ChipButton disabled count={0}>Disabled</ChipButton>
              </div>
            </Section>

            <Section title="Company logos" note="Stored logo, monogram in a hashed hue, and a logo that fails to load.">
              <div className="flex flex-wrap items-center gap-5">
                <CompanyLogo name="Hirelane" src="/brand/hirelane-mark.svg" size={48} />
                {["Razorpay", "Stripe", "Swiggy", "Zepto", "Notion", "Acme Rockets", "Globex", "Initech"].map((n) => (
                  <CompanyLogo key={n} name={n} size={48} />
                ))}
                <CompanyLogo name="Broken Co" src="/brand/does-not-exist.png" size={48} />
                <CompanyLogo name="Tiny" size={20} />
                <CompanyLogo name="Large" size={80} />
              </div>
            </Section>

            <Section title="Match ring" note="Strong, partial, weak, empty and full. Drag the slider.">
              <div className="flex flex-wrap items-center gap-8">
                <MatchRing score={score} size={96} />
                <MatchRing score={91} />
                <MatchRing score={62} />
                <MatchRing score={31} />
                <MatchRing score={0} />
                <MatchRing score={100} />
                <MatchRing score={78} size={36} strokeWidth={4} showValue={false} />
              </div>
              <div className="mt-5 max-w-sm">
                <RangeSlider label="Score" value={score} onValueChange={setScore} />
              </div>
            </Section>

            <Section title="Controls">
              <div className="grid gap-8 md:grid-cols-2">
                <div>
                  <Label>Segmented control</Label>
                  <SegmentedControl
                    label="Billing period"
                    value={period}
                    onChange={setPeriod}
                    segments={[{ value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }]}
                  />
                </div>
                <div>
                  <Label>Range slider</Label>
                  <RangeSlider label="Min match score" value={min} onValueChange={setMin} format={(n) => `${n}%`} />
                </div>
                <div>
                  <Label>Select</Label>
                  <Select
                    label="Role"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    options={[
                      { value: "software-engineer-backend", label: "Backend engineer" },
                      { value: "data-engineer", label: "Data engineer" },
                      { value: "product-manager", label: "Product manager" },
                    ]}
                  />
                  <div className="mt-4">
                    <Select label="With error" error="Pick a role to continue" options={[{ value: "", label: "Choose" }]} />
                  </div>
                </div>
                <div>
                  <Label>Combobox</Label>
                  <Combobox label="Company" placeholder="Search companies" options={COMPANIES} value={company} onChange={(v) => setCompany(v)} />
                  <p className="mt-2 text-[13px] text-ink-3" data-testid="combobox-value">Selected: {company ?? "none"}</p>
                  <div className="mt-4">
                    <Combobox label="Loading" loading options={[]} value={null} onChange={() => {}} placeholder="Searching" />
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Resume drop zone" note="PDF only. It never uploads.">
              <div className="grid gap-6 md:grid-cols-2">
                <DropZone onFile={(f) => setFile(f.name)} accepted={file} />
                <DropZone compact onFile={() => {}} title="Add your resume" disabled />
              </div>
            </Section>

            <Section title="Undo bar" note="Four-second linear drain. U or Escape to undo.">
              <div className="max-w-xl">
                {undo === "idle" && <Button onClick={() => setUndo("running")}>Approve and send</Button>}
                {undo === "running" && (
                  <UndoBar label="Sending to Razorpay" onUndo={() => setUndo("undone")} onComplete={() => setUndo("sent")} />
                )}
                {undo === "sent" && (
                  <p role="status" className="font-bold text-lane" data-testid="undo-result">Handed off to Razorpay&apos;s site</p>
                )}
                {undo === "undone" && (
                  <p role="status" className="font-bold text-ink-2" data-testid="undo-result">Undone. Nothing was sent.</p>
                )}
                {(undo === "sent" || undo === "undone") && (
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setUndo("idle")}>Reset</Button>
                )}
              </div>
            </Section>

            <Section title="Cards" note="Static, interactive and Needs-you.">
              <div className="grid gap-4 md:grid-cols-3">
                <Card flat>Flat card with only a border.</Card>
                <Card interactive>Interactive card. Hover to lift.</Card>
                <Card needsYou>
                  <p className="font-bold">Notice period?</p>
                  <p className="mt-1 text-[14px] text-ink-2">Only you can answer this one.</p>
                </Card>
              </div>
            </Section>

            <Section title="Skeletons">
              <div className="flex items-center gap-4">
                <Skeleton className="size-12 rounded-[12px]" />
                <div className="flex-1">
                  <Skeleton className="mb-3 h-4 w-1/3" />
                  <SkeletonText lines={2} />
                </div>
              </div>
            </Section>

            <Section title="Count up and reveal">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { v: 16320, l: "open roles" },
                  { v: 119, l: "companies" },
                  { v: 10663, l: "with salary shown" },
                ].map((s, i) => (
                  <Reveal key={s.l} delay={i * 0.08}>
                    <Card flat>
                      <div className="text-[40px] font-extrabold leading-none tracking-[-0.03em]">
                        <CountUp value={s.v} />
                      </div>
                      <p className="mt-2 text-[14px] text-ink-2">{s.l}</p>
                    </Card>
                  </Reveal>
                ))}
              </div>
            </Section>

            <Section title="Marquee" note="Pauses on hover and focus. Static under reduced motion.">
              <Marquee label="Freshest jobs">
                {TICKER.map(([c, t, ago]) => (
                  <a key={c} href="#" className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-control transition-shadow hover:shadow-card">
                    <CompanyLogo name={c} size={32} />
                    <span className="leading-tight">
                      <span className="block text-[14px] font-bold">{t}</span>
                      <span className="block text-[13px] text-ink-3">{c} · {ago}</span>
                    </span>
                  </a>
                ))}
              </Marquee>
            </Section>
          </Card>

          <div className="dark-band mt-10 rounded-[16px] p-8">
            <h2 className="text-[24px] font-extrabold tracking-[-0.03em]">Dark band</h2>
            <p className="mt-1 text-white/70">Controls on ink, with lane-green glow.</p>
            <div className="mt-6 grid gap-8 md:grid-cols-2">
              <RangeSlider tone="dark" label="Min match score" value={min} onValueChange={setMin} format={(n) => `${n}%`} />
              <Select tone="dark" label="Role" options={[{ value: "a", label: "Backend engineer" }, { value: "b", label: "Data engineer" }]} />
              <SegmentedControl tone="dark" label="Per day cap" value={period} onChange={setPeriod} segments={[{ value: "weekly", label: "5" }, { value: "monthly", label: "10" }, { value: "quarterly", label: "20" }]} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
