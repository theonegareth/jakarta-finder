// Builds districts.geojson (every Jabodetabek kecamatan) from GADM 4.1 level 3.
//	bun build-map.ts [path/to/gadm41_IDN_3.json]
import { $ } from "bun";

const GADM_ZIP = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IDN_3.json.zip";

// Kemendagri code prefix → city or regency
const CITIES: Record<string, string> = {
	"3173": "Jakarta Pusat", "3175": "Jakarta Utara", "3174": "Jakarta Barat", "3171": "Jakarta Selatan",
	"3172": "Jakarta Timur", "3101": "Kepulauan Seribu",
	"3271": "Kota Bogor", "3201": "Kabupaten Bogor", "3276": "Kota Depok", "3671": "Kota Tangerang",
	"3674": "Kota Tangerang Selatan", "3603": "Kabupaten Tangerang", "3275": "Kota Bekasi", "3216": "Kabupaten Bekasi",
};

// GADM squashes names ("KarangTengah"); these are the ones splitting on capitals gets wrong
const NAMES: Record<string, string> = {
	"3173010": "Tanah Abang", "3174040": "Grogol Petamburan", "3174020": "Kebon Jeruk", "3174060": "Taman Sari",
	"3171050": "Kebayoran Lama", "3171100": "Setiabudi", "3172050": "Kramat Jati", "3172010": "Pasar Rebo",
	"3172090": "Pulo Gadung", "3276030": "Sukmajaya", "3275010": "Pondok Gede", "3275012": "Pondok Melati",
	"3275030": "Bantar Gebang", "3275031": "Mustika Jaya", "3275011": "Jati Sampurna", "3216062": "Karang Bahagia",
	"3201231": "Rancabungur",
};

// Danau Sunter is a lake polygon inside Tanjung Priok
const MERGE: Record<string, string> = { "3175888": "3175030" };

type Feature = { type: "Feature"; properties: Record<string, string>; geometry: unknown };

let src = process.argv[2];
if (!src) {
	src = "/tmp/gadm41_IDN_3.json";
	await $`curl -sSfL ${GADM_ZIP} -o /tmp/gadm.zip && unzip -o -q /tmp/gadm.zip -d /tmp`;
}

const all = (await Bun.file(src).json()) as { features: Feature[] };
const features = all.features
	.map((f) => ({ ...f, code: MERGE[f.properties.CC_3] ?? f.properties.CC_3 }))
	.filter((f) => f.code.slice(0, 4) in CITIES);

const nameOf = new Map(features.map((f) => [f.code, NAMES[f.code] ?? f.properties.NAME_3.replace(/([a-z])([A-Z])/g, "$1 $2")]));
const seen = new Map<string, number>();
for (const n of nameOf.values()) seen.set(n, (seen.get(n) ?? 0) + 1);

const out = features.map((f) => {
	const city = CITIES[f.code.slice(0, 4)];
	const name = nameOf.get(f.code)!;
	return { type: "Feature", geometry: f.geometry, properties: { code: f.code, name: seen.get(name)! > 1 ? `${name} (${city})` : name, city } };
});

await Bun.write("/tmp/jabodetabek-raw.geojson", JSON.stringify({ type: "FeatureCollection", features: out }));
await $`bunx mapshaper /tmp/jabodetabek-raw.geojson -dissolve code copy-fields=name,city -simplify 8% keep-shapes -o precision=0.0001 districts.geojson`;
console.log(`${nameOf.size} kecamatan → districts.geojson`);
