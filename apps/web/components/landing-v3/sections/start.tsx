import { loadRoadPhotos } from "@/lib/landing-v3/photos";
import { StartPanelView } from "./start-panel";

/** The Start section (#start) over the dusk photograph. Server component: the photo list comes from road.json. */
export function StartPanel() {
  const dusk = loadRoadPhotos().find((p) => p.slot === "1800");
  return <StartPanelView photoSrc={dusk?.src} />;
}
