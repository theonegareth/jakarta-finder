import index from "./index.html";
import { find, MAP_PATH } from "./jev.ts";

const KEY_ENV = process.env.KEY_ENV ?? "OPENROUTER_API_KEY_CLAUDE_CODE";

const key = process.env[KEY_ENV];
if (!key) throw new Error(`${KEY_ENV} is not set; run \`. ~/.env\` first`);

const server = Bun.serve({
	routes: {
		"/": index,
		"/districts.geojson": new Response(Bun.file(MAP_PATH)),
		"/api/find": {
			POST: async (req) => {
				const { prompt } = (await req.json()) as { prompt?: unknown };
				if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 500) {
					return Response.json({ error: "prompt must be 1-500 characters" }, { status: 400 });
				}
				try {
					return Response.json(await find(prompt.trim(), key));
				} catch (e) {
					return Response.json({ error: (e as Error).message }, { status: 502 });
				}
			},
		},
	},
});

console.log(`jakarta-finder on ${server.url}`);
