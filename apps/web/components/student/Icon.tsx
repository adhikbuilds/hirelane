const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  cards: "M8 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM4 16V5a2 2 0 0 1 2-2h9",
  cal: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 2h6l1-2h5",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6",
  chev: "M9 6l6 6-6 6",
  x: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  mail: "M3 6h18v12H3zM3 7l9 6 9-6",
  arrow: "M5 12h14M13 6l6 6-6 6",
} as const;

export type IconName = keyof typeof P;

/** 1.5px outline icons from the approved mocks. Decorative: the label next to them carries the meaning. */
export function Ic({ name, small }: { name: IconName; small?: boolean }) {
  return (
    <svg className={small ? "st-ic st-s16" : "st-ic"} viewBox="0 0 24 24" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
