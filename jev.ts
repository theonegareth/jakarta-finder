const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
export const OUTSIDE = "Outside Greater Jakarta";
// cities below this share skip the second stage; their kecamatan read as 0
const CITY_FLOOR = 0.02;
const PROVINCES: Record<string, string> = { "31": "DKI Jakarta", "32": "Jawa Barat", "36": "Banten" };
// well-known places per city, so jev can place a landmark it half-knows; experiments.ts holds out places not named here
export const CITY_HINTS: Record<string, string> = {
	"Jakarta Pusat": "central Jakarta: Monas, Bundaran HI and Jalan Thamrin, Istana Merdeka, Senayan and Gelora Bung Karno, Tanah Abang market, Menteng, Kemayoran, Pasar Baru",
	"Jakarta Utara": "north Jakarta on the coast: Tanjung Priok port, Sunda Kelapa harbour, Pantai Indah Kapuk (PIK), Pluit, Kelapa Gading, Sunter",
	"Jakarta Barat": "west Jakarta: Kota Tua and Fatahillah square, Glodok chinatown, Grogol, Slipi, Kebon Jeruk, Cengkareng",
	"Jakarta Selatan": "south Jakarta: Blok M, Kemang, SCBD, Kuningan, Senopati, Ragunan zoo, Pasar Minggu",
	"Jakarta Timur": "east Jakarta: Taman Mini Indonesia Indah, Halim Perdanakusuma airport, Jatinegara, Rawamangun, Cawang, Pulo Gadung",
	"Kepulauan Seribu": "the Thousand Islands in Jakarta Bay: Pulau Pramuka, Pulau Untung Jawa, Pulau Tidung",
	"Kota Bogor": "Bogor city: Kebun Raya Bogor botanical garden, Istana Bogor, the Bogor city centre",
	"Kabupaten Bogor": "the regency around Bogor city: Cibinong, Sentul, Puncak and Cisarua, Taman Safari",
	"Kota Depok": "Depok city between Jakarta and Bogor: Universitas Indonesia campus, Jalan Margonda Raya, Cinere, Sawangan, Cimanggis",
	"Kota Tangerang": "Tangerang city west of Jakarta: Lippo Karawaci, Cipondoh, Ciledug, Pasar Lama Tangerang",
	"Kota Tangerang Selatan": "South Tangerang: BSD City and Serpong, Alam Sutera, Bintaro Jaya, Pamulang, Ciputat",
	"Kabupaten Tangerang": "the regency around Tangerang: Gading Serpong, the western side of BSD City around ICE BSD, PIK 2, Tigaraksa, Cikupa, Balaraja",
	"Kota Bekasi": "Bekasi city east of Jakarta: Summarecon Bekasi, Harapan Indah, Grand Galaxy, Pondok Gede, Jatiasih",
	"Kabupaten Bekasi": "the regency around Bekasi: Cikarang and its industrial estates (Jababeka, Lippo Cikarang), Meikarta, Tambun, Babelan",
};

type Props = { code: string; name: string; city: string };
export const MAP_PATH = `${import.meta.dir}/districts.geojson`;
const map = (await Bun.file(MAP_PATH).json()) as { features: { properties: Props }[] };

export const byCity = new Map<string, Props[]>();
for (const { properties: d } of map.features) byCity.set(d.city, [...(byCity.get(d.city) ?? []), d]);
const provinceOf = (d: Props) => PROVINCES[d.code.slice(0, 2)];

export function cityQuestion(hints = true) {
	return {
		type: "choice",
		instructions: "Which city or regency of greater Jakarta (Jabodetabek) is this place, landmark, food, event or description most associated with?",
		criteria: {
			...Object.fromEntries([...byCity].map(([city, ds]) => [city, `${city}, ${provinceOf(ds[0])}${hints ? `: ${CITY_HINTS[city]}` : ""}`])),
			[OUTSIDE]: "somewhere with no link to Jakarta or its satellite cities: another Indonesian region or another country",
		},
	};
}

export function kecamatanQuestion(city: string) {
	return {
		type: "choice",
		instructions: `Assume this is in ${city}. Which kecamatan of ${city} is this place, landmark, food, event or description most associated with?`,
		criteria: Object.fromEntries(byCity.get(city)!.map((d) => [d.name, `Kecamatan ${d.name.replace(/ \(.*\)$/, "")}, ${city}, ${provinceOf(d)}`])),
	};
}

export type Answer = { choice: string; confidence: number; probabilities: Record<string, number> };
export type Row = { district: string; city: string; p: number };
export type Result = { choice: string; confidence: number; city: string; cityConfidence: number; rows: Row[]; cost: number };

export type Reply = { answers: Record<string, Answer>; usage: { cost: number } };

export async function ask(prompt: string, questions: Record<string, object>, key: string): Promise<Reply> {
	const body = JSON.stringify({ model: "typesafe/jev-1.13", state: prompt, questions });
	for (let attempt = 0; ; attempt++) {
		// a dropped socket is as retryable as a 5xx; the alpha endpoint does both
		const res = await fetch(JEV_URL, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body }).catch((e: Error) => e);
		if (res instanceof Response && res.ok) return (await res.json()) as Reply;
		const retryable = !(res instanceof Response) || res.status >= 500;
		if (!retryable || attempt === 3) throw new Error(res instanceof Response ? `jev ${res.status}: ${await res.text()}` : `jev: ${res.message}`);
		await Bun.sleep(2 ** attempt * 1000);
	}
}

// P(kecamatan) = P(city) × P(kecamatan | city): two small questions keep jev sharp where one 186-way question smears
export async function find(prompt: string, key: string, hints = true): Promise<Result> {
	const outer = await ask(prompt, { city: cityQuestion(hints) }, key);
	const { city } = outer.answers;
	const likely = [...byCity.keys()].filter((c) => (city.probabilities[c] ?? 0) >= CITY_FLOOR);
	const second = likely.length ? await ask(prompt, Object.fromEntries(likely.map((c) => [c, kecamatanQuestion(c)])), key) : null;
	const inner = second?.answers ?? {};

	const rows: Row[] = [...byCity].flatMap(([c, ds]) => ds.map((d) => ({
		district: d.name,
		city: c,
		p: (city.probabilities[c] ?? 0) * (inner[c]?.probabilities[d.name] ?? 0),
	})));
	rows.push({ district: OUTSIDE, city: "Elsewhere", p: city.probabilities[OUTSIDE] ?? 0 });
	rows.sort((x, y) => y.p - x.p);
	const cost = outer.usage.cost + (second?.usage.cost ?? 0);
	return { choice: rows[0].district, confidence: rows[0].p, city: city.choice, cityConfidence: city.confidence, rows, cost };
}
