import index from "./index.html";

const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
const KEY_ENV = process.env.KEY_ENV ?? "OPENROUTER_API_KEY_CLAUDE_CODE";
const OUTSIDE = "Outside Greater Jakarta";
// cities below this share skip the second stage; their kecamatan read as 0
const CITY_FLOOR = 0.02;
const PROVINCES: Record<string, string> = { "31": "DKI Jakarta", "32": "Jawa Barat", "36": "Banten" };

type Props = { code: string; name: string; city: string };
const MAP_PATH = `${import.meta.dir}/districts.geojson`;
const map = (await Bun.file(MAP_PATH).json()) as { features: { properties: Props }[] };

const byCity = new Map<string, Props[]>();
for (const { properties: d } of map.features) byCity.set(d.city, [...(byCity.get(d.city) ?? []), d]);
const provinceOf = (d: Props) => PROVINCES[d.code.slice(0, 2)];

const cityQuestion = {
	type: "choice",
	instructions: "Which city or regency of greater Jakarta (Jabodetabek) is this place, landmark, food, event or description most associated with?",
	criteria: {
		...Object.fromEntries([...byCity].map(([city, ds]) => [city, `${city}, ${provinceOf(ds[0])}`])),
		[OUTSIDE]: "somewhere with no link to Jakarta or its satellite cities: another Indonesian region or another country",
	},
};

function kecamatanQuestion(city: string) {
	return {
		type: "choice",
		instructions: `Assume this is in ${city}. Which kecamatan of ${city} is this place, landmark, food, event or description most associated with?`,
		criteria: Object.fromEntries(byCity.get(city)!.map((d) => [d.name, `Kecamatan ${d.name.replace(/ \(.*\)$/, "")}, ${city}, ${provinceOf(d)}`])),
	};
}

type Answer = { choice: string; confidence: number; probabilities: Record<string, number> };
export type Row = { district: string; city: string; p: number };
export type Result = { choice: string; confidence: number; city: string; cityConfidence: number; rows: Row[] };

async function ask(prompt: string, questions: Record<string, object>, key: string): Promise<Record<string, Answer>> {
	const body = JSON.stringify({ model: "typesafe/jev-1.13", state: prompt, questions });
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(JEV_URL, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body });
		if (res.ok) return ((await res.json()) as { answers: Record<string, Answer> }).answers;
		if (res.status < 500 || attempt === 3) throw new Error(`jev ${res.status}: ${await res.text()}`);
		await Bun.sleep(2 ** attempt * 1000);
	}
}

// P(kecamatan) = P(city) × P(kecamatan | city): two small questions keep jev sharp where one 186-way question smears
async function find(prompt: string, key: string): Promise<Result> {
	const { city } = await ask(prompt, { city: cityQuestion }, key);
	const likely = [...byCity.keys()].filter((c) => (city.probabilities[c] ?? 0) >= CITY_FLOOR);
	const inner = likely.length ? await ask(prompt, Object.fromEntries(likely.map((c) => [c, kecamatanQuestion(c)])), key) : {};

	const rows: Row[] = [...byCity].flatMap(([c, ds]) => ds.map((d) => ({
		district: d.name,
		city: c,
		p: (city.probabilities[c] ?? 0) * (inner[c]?.probabilities[d.name] ?? 0),
	})));
	rows.push({ district: OUTSIDE, city: "Elsewhere", p: city.probabilities[OUTSIDE] ?? 0 });
	rows.sort((x, y) => y.p - x.p);
	return { choice: rows[0].district, confidence: rows[0].p, city: city.choice, cityConfidence: city.confidence, rows };
}

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
