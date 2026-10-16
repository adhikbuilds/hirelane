/** Server-only: reads public/landing/road.json. The pure parsing lives in ./road so client code never pulls in node:fs. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRoad, type RoadShot } from "./road";

/** Loads the four photos with their sign rectangles. A missing file or bad JSON gives the fallback, never an exception. */
export function loadRoad(root: string = join(process.cwd(), "public", "landing")): RoadShot[] {
  try {
    return parseRoad(JSON.parse(readFileSync(join(root, "road.json"), "utf8")));
  } catch {
    return parseRoad(null);
  }
}
