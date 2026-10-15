// Two experiments against jev, raw answers kept so a corrected answer key only needs a re-score.
//	. ~/.env && bun experiments.ts run raw.jsonl [runs=3]
//	bun experiments.ts score raw.jsonl outdir/
// variants: one 186-way question vs two stages vs two stages with city hints, on greater Jakarta.
// cities: Singapore vs DKI Jakarta, same two-stage question, no hints, iconic vs everyday places.
import { ask, byCity, find, kecamatanQuestion, OUTSIDE } from "./jev.ts";

const KEY_ENV = process.env.KEY_ENV ?? "OPENROUTER_API_KEY_CLAUDE_CODE";
const WORKERS = 6;

// [prompt, group, answer]; "|" between answers that are all right, each checked against a source on 2026-09-30
type Case = [string, string, string];

// "named" places appear in CITY_HINTS; "held out" ones do not, so they measure whether hints generalise
const JABODETABEK: Case[] = [
	["Monas", "named", "Gambir"],
	["Blok M", "named", "Kebayoran Baru"],
	["Kota Tua", "named", "Taman Sari|Tambora"],
	["Pantai Indah Kapuk", "named", "Penjaringan"],
	["BSD City", "named", "Serpong|Serpong Utara|Pagedangan|Cisauk"],
	["Kebun Raya Bogor", "named", "Bogor Tengah"],
	["Stadion GBK", "named", "Tanah Abang"],
	["Kampus UI", "named", "Beji"],
	["Margonda Raya", "named", "Beji|Pancoran Mas"],
	["Summarecon Bekasi", "named", "Bekasi Utara"],
	["Pondok Indah Mall", "held out", "Kebayoran Lama"],
	["Stasiun Manggarai", "held out", "Tebet"],
	["Mall Taman Anggrek", "held out", "Grogol Petamburan"],
	["Dufan", "held out", "Pademangan"],
	["Kota Wisata Cibubur", "held out", "Gunung Putri"],
	["AEON Mall Jakarta Garden City", "held out", "Cakung"],
	["Stasiun Gambir", "held out", "Gambir"],
	["Lippo Mall Puri", "held out", "Kembangan"],
	["Stasiun Depok Baru", "held out", "Pancoran Mas"],
	["Bandara Soekarno-Hatta", "held out", "Benda|Neglasari|Kosambi|Teluknaga"],
];

type Place = { name: string; unit: string; area: string; regions: Record<string, string[]>; cases: Case[] };

const DKI: Place = {
	name: "DKI Jakarta", unit: "city", area: "kecamatan",
	regions: Object.fromEntries([...byCity].filter(([, ds]) => ds[0].code.startsWith("31")).map(([c, ds]) => [c, ds.map((d) => d.name)])),
	cases: [
		["Monas", "iconic", "Gambir"], ["Masjid Istiqlal", "iconic", "Sawah Besar"], ["Kota Tua", "iconic", "Taman Sari|Tambora"],
		["Stadion GBK", "iconic", "Tanah Abang"], ["Bundaran HI", "iconic", "Menteng"], ["Blok M", "iconic", "Kebayoran Baru"],
		["Dufan", "iconic", "Pademangan"], ["Taman Mini Indonesia Indah", "iconic", "Cipayung (Jakarta Timur)|Kramat Jati"],
		["Kebun Binatang Ragunan", "iconic", "Pasar Minggu"], ["Pantai Indah Kapuk", "iconic", "Penjaringan"],
		["Grand Indonesia", "everyday", "Tanah Abang|Menteng"], ["Pondok Indah Mall", "everyday", "Kebayoran Lama"],
		["Mall Taman Anggrek", "everyday", "Grogol Petamburan"], ["Mall Kelapa Gading", "everyday", "Kelapa Gading"],
		["AEON Mall Jakarta Garden City", "everyday", "Cakung"], ["Lippo Mall Puri", "everyday", "Kembangan"],
		["Stasiun Manggarai", "everyday", "Tebet"], ["RSCM", "everyday", "Senen"],
		["Universitas Trisakti", "everyday", "Grogol Petamburan"], ["Kalibata City", "everyday", "Pancoran"],
	],
};

const SINGAPORE: Place = {
	name: "Singapore", unit: "region", area: "planning area",
	regions: {
		Central: ["Bishan", "Bukit Merah", "Bukit Timah", "Downtown Core", "Geylang", "Kallang", "Marina East", "Marina South", "Marine Parade", "Museum", "Newton", "Novena", "Orchard", "Outram", "Queenstown", "River Valley", "Rochor", "Singapore River", "Southern Islands", "Straits View", "Tanglin", "Toa Payoh"],
		East: ["Bedok", "Changi", "Changi Bay", "Pasir Ris", "Paya Lebar", "Tampines"],
		North: ["Central Water Catchment", "Lim Chu Kang", "Mandai", "Sembawang", "Simpang", "Sungei Kadut", "Woodlands", "Yishun"],
		"North-East": ["Ang Mo Kio", "Hougang", "North-Eastern Islands", "Punggol", "Seletar", "Sengkang", "Serangoon"],
		West: ["Boon Lay", "Bukit Batok", "Bukit Panjang", "Choa Chu Kang", "Clementi", "Jurong East", "Jurong West", "Pioneer", "Tengah", "Tuas", "Western Islands", "Western Water Catchment"],
	},
	cases: [
		["Merlion", "iconic", "Downtown Core"], ["Marina Bay Sands", "iconic", "Downtown Core"], ["Gardens by the Bay", "iconic", "Marina South|Downtown Core"],
		["Sentosa", "iconic", "Southern Islands"], ["Orchard Road", "iconic", "Orchard|Museum"], ["Changi Airport", "iconic", "Changi"],
		["Chinatown", "iconic", "Outram"], ["Little India", "iconic", "Rochor"], ["Clarke Quay", "iconic", "Singapore River"],
		["Singapore Botanic Gardens", "iconic", "Tanglin"],
		["Raffles Hotel", "everyday", "Downtown Core"], ["VivoCity", "everyday", "Bukit Merah"], ["Jurong Point", "everyday", "Jurong West"],
		["Tampines Mall", "everyday", "Tampines"], ["Causeway Point", "everyday", "Woodlands"], ["NEX mall", "everyday", "Serangoon"],
		["Northpoint City", "everyday", "Yishun"], ["National University of Singapore", "everyday", "Queenstown"],
		["Singapore General Hospital", "everyday", "Bukit Merah"], ["Tiong Bahru Market", "everyday", "Bukit Merah"],
	],
};

type Raw = { exp: string; arm: string; prompt: string; run: number; p: Record<string, number>; cost: number; ms: number };

const jaboRegion = new Map([...[...byCity].flatMap(([c, ds]) => ds.map((d) => [d.name, c] as const)), [OUTSIDE, "Elsewhere"] as const]);
const regionOf = (arm: string) => (area: string) =>
	arm === SINGAPORE.name || arm === DKI.name
		? Object.entries((arm === SINGAPORE.name ? SINGAPORE : DKI).regions).find(([, as]) => as.includes(area))?.[0] ?? "?"
		: jaboRegion.get(area) ?? "?";
const casesOf = (exp: string, arm: string) => (exp === "variants" ? JABODETABEK : arm === SINGAPORE.name ? SINGAPORE.cases : DKI.cases);

async function oneShot(prompt: string, key: string) {
	const criteria = {
		...Object.assign({}, ...[...byCity.keys()].map((c) => kecamatanQuestion(c).criteria)),
		[OUTSIDE]: "somewhere with no link to Jakarta or its satellite cities: another Indonesian region or another country",
	};
	const r = await ask(prompt, { d: { type: "choice", instructions: "Which district of greater Jakarta is this place, landmark, food, event or description most associated with?", criteria } }, key);
	return { p: r.answers.d.probabilities, cost: r.usage.cost };
}

async function twoStage(place: Place, prompt: string, key: string) {
	const outer = await ask(prompt, { r: {
		type: "choice",
		instructions: `Which ${place.unit} of ${place.name} is this place most associated with?`,
		criteria: Object.fromEntries(Object.keys(place.regions).map((r) => [r, `${r}, ${place.name}`])),
	} }, key);
	const rp = outer.answers.r.probabilities;
	const likely = Object.keys(place.regions).filter((r) => (rp[r] ?? 0) >= 0.02);
	const inner = await ask(prompt, Object.fromEntries(likely.map((r) => [r, {
		type: "choice",
		instructions: `Assume this is in ${r}, ${place.name}. Which ${place.area} is this place most associated with?`,
		criteria: Object.fromEntries(place.regions[r].map((a) => [a, `${a}, ${r}, ${place.name}`])),
	}])), key);
	const p: Record<string, number> = {};
	for (const r of likely) for (const [a, q] of Object.entries(inner.answers[r].probabilities)) p[a] = (rp[r] ?? 0) * q;
	return { p, cost: outer.usage.cost + inner.usage.cost };
}

async function pool<T>(jobs: (() => Promise<T>)[], n: number): Promise<T[]> {
	const out: T[] = [];
	let next = 0;
	await Promise.all(Array.from({ length: n }, async () => {
		while (next < jobs.length) {
			const i = next++;
			out[i] = await jobs[i]();
		}
	}));
	return out;
}

async function run(path: string, runs: number) {
	const key = process.env[KEY_ENV];
	if (!key) throw new Error(`${KEY_ENV} is not set`);
	const arms: [string, string, (prompt: string) => Promise<{ p: Record<string, number>; cost: number }>][] = [
		["variants", "one question", (q) => oneShot(q, key)],
		["variants", "two stages", async (q) => { const r = await find(q, key, false); return { p: Object.fromEntries(r.rows.map((x) => [x.district, x.p])), cost: r.cost }; }],
		["variants", "two stages + hints", async (q) => { const r = await find(q, key, true); return { p: Object.fromEntries(r.rows.map((x) => [x.district, x.p])), cost: r.cost }; }],
		["cities", SINGAPORE.name, (q) => twoStage(SINGAPORE, q, key)],
		["cities", DKI.name, (q) => twoStage(DKI, q, key)],
	];
	const jobs = arms.flatMap(([exp, arm, fn]) => casesOf(exp, arm).flatMap(([prompt]) => Array.from({ length: runs }, (_, run) => async (): Promise<Raw> => {
		const t = performance.now();
		const r = await fn(prompt);
		return { exp, arm, prompt, run, p: r.p, cost: r.cost, ms: Math.round(performance.now() - t) };
	})));
	const rows = await pool(jobs, WORKERS);
	await Bun.write(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
	console.log(`${rows.length} runs → ${path}, $${rows.reduce((s, r) => s + r.cost, 0).toFixed(4)}`);
}

const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";

async function score(path: string, dir: string) {
	const raws = (await Bun.file(path).text()).trim().split("\n").map((l) => JSON.parse(l) as Raw);
	const scored = raws.map((r) => {
		const [, group, answer] = casesOf(r.exp, r.arm).find(([q]) => q === r.prompt)!;
		const ok = answer.split("|");
		const region = regionOf(r.arm);
		const [top, pTop] = Object.entries(r.p).sort((x, y) => y[1] - x[1])[0];
		return {
			...r, group, answer, top, pTop,
			topRegion: region(top),
			regionOk: ok.some((a) => region(a) === region(top)),
			areaOk: ok.includes(top),
			pCorrect: ok.reduce((s, a) => s + (r.p[a] ?? 0), 0),
		};
	});
	await Bun.write(`${dir}/runs.csv`, csv([
		["experiment", "arm", "group", "prompt", "run", "answer", "top", "top_region", "region_ok", "area_ok", "p_correct", "p_top", "cost_usd", "ms"],
		...scored.map((s) => [s.exp, s.arm, s.group, s.prompt, s.run, s.answer, s.top, s.topRegion, +s.regionOk, +s.areaOk, s.pCorrect.toFixed(4), s.pTop.toFixed(4), s.cost.toFixed(7), s.ms]),
	]));

	const keyOf = (s: (typeof scored)[number]) => `${s.exp}\t${s.arm}\t${s.group}\t${s.prompt}`;
	const byPrompt = Map.groupBy(scored, keyOf);
	await Bun.write(`${dir}/prompts.csv`, csv([
		["experiment", "arm", "group", "prompt", "answer", "runs", "area_ok_runs", "region_ok_runs", "mean_p_correct", "tops"],
		...[...byPrompt].map(([k, ss]) => [...k.split("\t").slice(0, 3), ss[0].prompt, ss[0].answer, ss.length, ss.filter((s) => s.areaOk).length, ss.filter((s) => s.regionOk).length, (ss.reduce((a, s) => a + s.pCorrect, 0) / ss.length).toFixed(4), [...new Set(ss.map((s) => s.top))].join("; ")]),
	]));

	const summary: (string | number)[][] = [["experiment", "arm", "group", "runs", "region_acc", "area_acc", "mean_p_correct", "median_ms", "mean_cost_usd"]];
	for (const [k, ss] of Map.groupBy(scored.flatMap((s) => [{ ...s, g: s.group }, { ...s, g: "all" }]), (s) => `${s.exp}\t${s.arm}\t${s.g}`)) {
		const ms = ss.map((s) => s.ms).sort((a, b) => a - b);
		summary.push([...k.split("\t"), ss.length, (ss.filter((s) => s.regionOk).length / ss.length).toFixed(3), (ss.filter((s) => s.areaOk).length / ss.length).toFixed(3), (ss.reduce((a, s) => a + s.pCorrect, 0) / ss.length).toFixed(3), ms[Math.floor(ms.length / 2)], (ss.reduce((a, s) => a + s.cost, 0) / ss.length).toFixed(6)]);
	}
	await Bun.write(`${dir}/summary.csv`, csv(summary));
	console.log(summary.map((r) => r.join("  ")).join("\n"));
}

const [cmd, path, arg] = process.argv.slice(2);
if (cmd === "run") await run(path, Number(arg ?? 3));
else if (cmd === "score") await score(path, arg ?? ".");
else throw new Error("usage: bun experiments.ts run <raw.jsonl> [runs] | score <raw.jsonl> <outdir>");
