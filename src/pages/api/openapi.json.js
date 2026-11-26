import { openApi } from '../../../lib/discovery.js';

export function GET() {
  return Response.json(openApi);
}
