import { discoveryManifest } from '../../../lib/discovery.js';

export function GET() {
  return Response.json(discoveryManifest);
}
