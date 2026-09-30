// Scores the running server against places with a known kecamatan.
//	bun eval.ts [http://localhost:3217]
import type { Result } from "./server.ts";

const BASE = process.argv[2] ?? "http://localhost:3217";

// [prompt, city, kecamatan], "|" between answers that are all right; the held-out half names nothing the city descriptions mention
const CASES: [string, string, string][] = [
	["Monas", "Jakarta Pusat", "Gambir"],
	["Blok M", "Jakarta Selatan", "Kebayoran Baru"],
	["Kota Tua", "Jakarta Barat", "Taman Sari"],
	["Pantai Indah Kapuk", "Jakarta Utara", "Penjaringan"],
	["BSD City", "Kota Tangerang Selatan|Kabupaten Tangerang", "Serpong|Pagedangan|Cisauk"],
	["Kebun Raya Bogor", "Kota Bogor", "Bogor Tengah"],
	["Stadion GBK", "Jakarta Pusat", "Tanah Abang"],
	["Kampus UI", "Kota Depok", "Beji"],
	["Margonda Raya", "Kota Depok", "Beji|Pancoran Mas"],
	["Summarecon Bekasi", "Kota Bekasi", "Bekasi Utara"],
	// held out
	["Pondok Indah Mall", "Jakarta Selatan", "Kebayoran Lama"],
	["Stasiun Manggarai", "Jakarta Selatan", "Tebet"],
	["Mall Taman Anggrek", "Jakarta Barat", "Grogol Petamburan"],
	["Dufan", "Jakarta Utara", "Pademangan"],
	["Kota Wisata Cibubur", "Kabupaten Bogor", "Gunung Putri"],
	["AEON Mall Jakarta Garden City", "Jakarta Timur", "Cakung"],
	["Stasiun Gambir", "Jakarta Pusat", "Gambir"],
	["Lippo Mall Puri", "Jakarta Barat", "Kembangan"],
	["Stasiun Depok Baru", "Kota Depok", "Pancoran Mas"],
	["Bandara Soekarno-Hatta", "Kota Tangerang", "Benda"],
];

async function find(prompt: string): Promise<Result> {
	const res = await fetch(`${BASE}/api/find`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
	if (!res.ok) throw new Error(`${prompt}: ${res.status} ${await res.text()}`);
	return (await res.json()) as Result;
}

const results = await Promise.all(CASES.map(async ([prompt, city, kec]) => ({ prompt, city, kec, r: await find(prompt) })));
let cityHits = 0, kecHits = 0;
for (const { prompt, city, kec, r } of results) {
	const top = r.rows[0];
	const cityOk = city.split("|").includes(top.city);
	const kecOk = kec.split("|").includes(top.district);
	cityHits += +cityOk;
	kecHits += +kecOk;
	const pKec = r.rows.filter((x) => kec.split("|").includes(x.district)).reduce((sum, x) => sum + x.p, 0);
	console.log(`${cityOk ? "✓" : "✗"}${kecOk ? "✓" : "✗"} ${prompt.padEnd(30)} → ${top.district} (${top.city}) ${(top.p * 100).toFixed(0)}%   want ${kec} ${(pKec * 100).toFixed(0)}%`);
}
console.log(`\ncity ${cityHits}/${CASES.length}   kecamatan ${kecHits}/${CASES.length}`);
