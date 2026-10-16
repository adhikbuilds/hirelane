"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/shadcn/accordion";
import { Button } from "@/components/shadcn/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/shadcn/dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/shadcn/select";
import { Slider } from "@/components/shadcn/slider";
import { Toaster } from "@/components/shadcn/sonner";
import { Switch } from "@/components/shadcn/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/shadcn/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/shadcn/tooltip";

type Ground = "forest" | "white" | "black";

function Specimen({ ground }: { ground: Ground }) {
  const [match, setMatch] = useState([70]);
  const [floor, setFloor] = useState([18]);
  const [remote, setRemote] = useState(true);
  const [perDay, setPerDay] = useState("3");

  return (
    <section
      data-landing="v3"
      data-ground={ground === "forest" ? undefined : ground}
      className="bg-background text-foreground px-6 py-16 md:px-16"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-12">
        <h2 className="t-heading">Set the rule once on {ground}.</h2>

        <div className="flex flex-wrap items-center gap-4">
          <Button>Start with your resume</Button>
          <Button variant="secondary">Browse 16,320 open roles</Button>
          <Button variant="ghost">Sign in</Button>
          <Button variant="link">How it reads pay</Button>
          <Button size="sm">Start free</Button>
          <Button disabled>Disabled</Button>
        </div>

        <div className="grid gap-10 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label htmlFor={`m-${ground}`} className="t-body font-bold">
              Minimum match: {match[0]}%
            </label>
            <Slider id={`m-${ground}`} value={match} onValueChange={setMatch} min={0} max={100} step={5} aria-label="Minimum match" />
          </div>
          <div className="flex flex-col gap-3">
            <span className="t-body font-bold">Pay floor: ₹{floor[0]} L/yr</span>
            <Slider value={floor} onValueChange={setFloor} min={0} max={80} step={1} aria-label="Pay floor" />
          </div>
          <div className="flex flex-col gap-3">
            <span className="t-body font-bold">Role</span>
            <Select defaultValue="software">
              <SelectTrigger aria-label="Role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectGroup>
                  <SelectItem value="software">Software engineering</SelectItem>
                  <SelectItem value="data">Data and analytics</SelectItem>
                  <SelectItem value="design">Design</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor={`r-${ground}`} className="t-body font-bold">
              Remote only
            </label>
            <Switch id={`r-${ground}`} checked={remote} onCheckedChange={setRemote} />
          </div>
          <div className="flex flex-col gap-3">
            <span className="t-body font-bold">Drafts per day</span>
            <ToggleGroup type="single" value={perDay} onValueChange={(v) => v && setPerDay(v)} aria-label="Drafts per day">
              {["1", "3", "5", "10"].map((n) => (
                <ToggleGroupItem key={n} value={n} aria-label={`${n} drafts per day`}>
                  {n}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary">Hover or focus me</Button>
                </TooltipTrigger>
                <TooltipContent>Demo on real jobs. Nothing is sent.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button variant="secondary" onClick={() => toast("Handed off to Stripe's site", { description: "You can undo for 4 seconds." })}>
              Show a toast
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button>Open dialog</Button>
              </DialogTrigger>
              <DialogContent data-ground={ground === "white" ? "white" : undefined}>
                <DialogHeader>
                  <DialogTitle>Start with your resume</DialogTitle>
                  <DialogDescription>Your resume is read in this browser. It never leaves it.</DialogDescription>
                </DialogHeader>
                <Button className="w-fit">Choose a file</Button>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Accordion type="single" collapsible defaultValue="a">
          <AccordionItem value="a">
            <AccordionTrigger>Does it apply without asking me?</AccordionTrigger>
            <AccordionContent>No. Nothing leaves until you press approve, and you get four seconds to undo.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="b">
            <AccordionTrigger>Where does the pay figure come from?</AccordionTrigger>
            <AccordionContent>From the exact words in the posting. Hirelane shows you the sentence it read.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </section>
  );
}

export function Kit() {
  return (
    <div className="flex flex-col">
      <Specimen ground="forest" />
      <Specimen ground="white" />
      <Specimen ground="black" />
      <div data-landing="v3">
        <Toaster />
      </div>
    </div>
  );
}
