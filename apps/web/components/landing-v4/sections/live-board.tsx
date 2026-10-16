import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { countryName, roleLabel } from "../../board/labels";
import { Chapter, H2, LEAD } from "./chapter";
import { boardHref, cellKey, SAMPLE_COUNTRY, SAMPLE_ROLE, type BoardModel } from "./board-model";
import { getBoard } from "./data";
import { Reveal } from "./reveal";

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);

/** Quick links: Asha's cell first, then the biggest remaining cells of the table. */
export function quickLinks(b: BoardModel, max = 5): { href: string; label: string }[] {
  const cells = b.roles.flatMap((r) => b.countries.map((c) => ({ r, c, n: b.counts[cellKey(r, c)] ?? 0 }))).filter((x) => x.n > 0);
  cells.sort((x, y) => Number(y.r === SAMPLE_ROLE && y.c === SAMPLE_COUNTRY) - Number(x.r === SAMPLE_ROLE && x.c === SAMPLE_COUNTRY) || y.n - x.n);
  return cells.slice(0, max).map(({ r, c }) => ({ href: boardHref(r, c), label: `${roleLabel(r)} jobs in ${countryName(c)}` }));
}

export function LiveBoardView({ board }: { board: BoardModel }) {
  const chips = quickLinks(board);
  return (
    <Chapter id="board" chapter="Proof" label="Live board">
      <Reveal className="max-w-[640px]">
        <h2 className={H2}>See the jobs first.</h2>
        <p className={`${LEAD} mt-5`}>Open roles right now, by role and country.</p>
      </Reveal>

      <Reveal index={1} className="mt-10">
        <div className="overflow-x-auto rounded-[24px] bg-card shadow-[0_1px_2px_rgb(19_32_26/.06),0_24px_48px_-28px_rgb(19_32_26/.3)] ring-1 ring-black/5">
          <table className="w-full min-w-[620px] border-collapse text-left" data-testid="board-table">
            <caption className="sr-only">Open jobs by role family and country</caption>
            <thead>
              <tr className="border-b border-black/10 text-[13px] font-bold text-muted-foreground">
                <th scope="col" className="px-5 py-4 font-bold">Role</th>
                {board.countries.map((c) => (
                  <th key={c} scope="col" className={`px-4 py-4 text-right font-bold ${c === SAMPLE_COUNTRY ? "text-primary" : ""}`}>
                    <Link href={boardHref(undefined, c)} className="rounded-[6px] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                      {countryName(c)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.roles.map((r) => {
                const sample = r === SAMPLE_ROLE;
                return (
                  <tr key={r} data-sample={sample || undefined} className={`border-b border-black/5 last:border-0 ${sample ? "bg-[var(--lime)]/45" : "hover:bg-accent/50"}`}>
                    <th scope="row" className="px-5 py-3.5 text-[15px] font-bold">
                      <Link href={boardHref(r)} className="rounded-[6px] outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
                        {roleLabel(r)}
                      </Link>
                      {sample && <span className="ml-2 rounded-full bg-[var(--ink)] px-2 py-0.5 align-middle text-[11px] font-bold text-[var(--lime)]">Asha</span>}
                    </th>
                    {board.countries.map((c) => {
                      const n = board.counts[cellKey(r, c)] ?? 0;
                      return (
                        <td key={c} className="num p-0 text-right">
                          <Link
                            href={boardHref(r, c)}
                            aria-label={`${fmt(n)} ${roleLabel(r)} jobs in ${countryName(c)}`}
                            className={`group inline-flex min-h-11 w-full items-center justify-end gap-1 px-4 py-3 text-[15px] tabular-nums outline-none transition-colors duration-150 hover:bg-primary hover:text-primary-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${sample && c === SAMPLE_COUNTRY ? "font-extrabold" : "font-semibold"}`}
                          >
                            {fmt(n)}
                            <ArrowUpRight aria-hidden className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Reveal>

      <Reveal index={2} className="mt-6">
        <ul className="flex flex-wrap gap-2" aria-label="Quick links">
          {chips.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="inline-flex min-h-11 items-center rounded-full bg-card px-4 text-[14px] font-bold ring-1 ring-black/10 outline-none transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_16px_-8px_rgb(19_32_26/.3)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-95">
                {c.label}
              </Link>
            </li>
          ))}
        </ul>
      </Reveal>
    </Chapter>
  );
}

/** Chapter 6, proof: live counts from the database, Asha's row highlighted. */
export async function LiveBoard() {
  return <LiveBoardView board={await getBoard()} />;
}
