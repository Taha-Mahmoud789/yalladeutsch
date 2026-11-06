import { relay } from "../../../server/relay";

export const runtime = "nodejs";

export function GET(request) {
  return relay(request);
}

export function POST(request) {
  return relay(request);
}
