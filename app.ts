import type { Result } from "./server.ts";

const EXAMPLES = ["Monas", "Blok M", "Kota Tua", "Pantai Indah Kapuk", "BSD City", "Kebun Raya Bogor", "Kerak telor", "Stadion GBK", "Kampus UI", "Merlion"];
const COLORS: Record<string, string> = {
	"Jakarta Pusat": "var(--pusat)", "Jakarta Utara": "var(--utara)", "Jakarta Barat": "var(--barat)",
	"Jakarta Selatan": "var(--selatan)", "Jakarta Timur": "var(--timur)", "Kepulauan Seribu": "var(--seribu)",
	Elsewhere: "var(--elsewhere)",
};
const SVG = "http://www.w3.org/2000/svg";
const W = 700;

type Ring = [number, number][];
type Geometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
type Feature = { properties: { name: string; city: string }; geometry: Geometry };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>("form");
const input = $<HTMLInputElement>("prompt");
const go = $<HTMLButtonElement>("go");
const out = $<HTMLDivElement>("out");
const svg = document.getElementById("map") as unknown as SVGSVGElement;
const paths = new Map<string, SVGPathElement>();
let showAll = false;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	e.textContent = text;
	return e;
}

function bounds(pts: [number, number][]) {
	const [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
	const [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
	return { x0, x1, y0, y1, kx: Math.cos(((y0 + y1) / 2) * (Math.PI / 180)) };
}

async function drawMap() {
	const { features } = (await (await fetch("/districts.geojson")).json()) as { features: Feature[] };
	const polys = (g: Geometry) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
	const isIsland = (f: Feature) => f.properties.city === "Kepulauan Seribu";
	const ptsOf = (fs: Feature[]) => fs.flatMap((f) => polys(f.geometry).flat(2));

	const main = bounds(ptsOf(features.filter((f) => !isIsland(f))));
	const s = W / ((main.x1 - main.x0) * main.kx);
	const H = Math.round((main.y1 - main.y0) * s);
	svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

	// Kepulauan Seribu reaches 80 km out to sea, so it gets an inset in the open water of Jakarta Bay, roughly where it really is
	const box = { x: 300, y: 8, w: 120, h: 124 };
	const isl = bounds(ptsOf(features.filter(isIsland)));
	const si = Math.min((box.w - 16) / ((isl.x1 - isl.x0) * isl.kx), (box.h - 30) / (isl.y1 - isl.y0));
	const padX = (box.w - (isl.x1 - isl.x0) * isl.kx * si) / 2;
	const frame = document.createElementNS(SVG, "rect");
	for (const [k, v] of Object.entries({ x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, class: "inset" })) frame.setAttribute(k, String(v));
	const label = document.createElementNS(SVG, "text");
	for (const [k, v] of Object.entries({ x: box.x + 8, y: box.y + 16, class: "inset-label" })) label.setAttribute(k, String(v));
	label.textContent = "Kep. Seribu";

	const fit = (f: Feature) => isIsland(f)
		? ([lon, lat]: [number, number]) => `${(box.x + padX + (lon - isl.x0) * isl.kx * si).toFixed(1)},${(box.y + 22 + (isl.y1 - lat) * si).toFixed(1)}`
		: ([lon, lat]: [number, number]) => `${((lon - main.x0) * main.kx * s).toFixed(1)},${((main.y1 - lat) * s).toFixed(1)}`;
	for (const f of features) {
		const project = fit(f);
		const path = document.createElementNS(SVG, "path");
		path.setAttribute("d", polys(f.geometry).flatMap((poly) => poly.map((ring) => `M${ring.map(project).join("L")}Z`)).join(""));
		if (isIsland(f)) path.classList.add("island");
		const title = document.createElementNS(SVG, "title");
		title.textContent = `${f.properties.name}, ${f.properties.city}`;
		path.append(title);
		paths.set(f.properties.name, path);
		svg.append(path);
	}
	svg.append(frame, label, ...svg.querySelectorAll("path.island"));
}

function shade(r: Result) {
	const max = r.rows[0]?.p || 1;
	for (const row of r.rows) {
		const path = paths.get(row.district);
		if (!path) continue;
		// sqrt so a 3% runner-up still shows next to an 80% pick
		const heat = Math.round(Math.sqrt(row.p / max) * 100);
		path.style.fill = `color-mix(in oklab, var(--hot) ${heat}%, var(--land))`;
		// islands are specks at inset scale, so a fat stroke in the same colour is what reads
		if (path.classList.contains("island")) path.style.stroke = `color-mix(in oklab, var(--hot) ${heat}%, var(--muted))`;
		path.querySelector("title")!.textContent = `${row.district}, ${row.city}: ${(row.p * 100).toFixed(1)}%`;
	}
}

function render(r: Result) {
	shade(r);
	out.replaceChildren();
	const pick = el("div", "pick");
	pick.append(
		el("b", "", r.choice),
		el("span", "", `  ${(r.confidence * 100).toFixed(0)}% · ${r.city} at ${(r.cityConfidence * 100).toFixed(0)}% confidence`),
	);
	out.append(pick);

	const max = r.rows[0]?.p || 1;
	const bars: HTMLElement[] = [];
	for (const row of showAll ? r.rows : r.rows.slice(0, 12)) {
		const line = el("div", "row");
		const name = el("div", "name", row.district);
		name.title = `${row.district}, ${row.city}`;
		name.append(el("small", "", ` ${row.city}`));
		const bar = el("div", "bar");
		bar.style.background = COLORS[row.city] ?? "var(--bodetabek)";
		bar.style.width = "0";
		bar.dataset.w = `${(row.p / max) * 100}%`;
		bars.push(bar);
		const track = el("div", "");
		track.append(bar);
		line.append(name, track, el("div", "pct", `${(row.p * 100).toFixed(1)}%`));
		out.append(line);
	}
	requestAnimationFrame(() => bars.forEach((b) => (b.style.width = b.dataset.w!)));

	const more = el("button", "", showAll ? "Top 12 only" : `Show all ${r.rows.length}`);
	more.id = "more";
	more.onclick = () => {
		showAll = !showAll;
		render(r);
	};
	out.append(more);
}

async function find(prompt: string) {
	input.value = prompt;
	go.disabled = true;
	out.replaceChildren(el("p", "sub", `Asking jev about “${prompt}”…`));
	try {
		const res = await fetch("/api/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
		const body = (await res.json()) as Result | { error: string };
		if ("error" in body) throw new Error(body.error);
		render(body);
	} catch (e) {
		out.replaceChildren(el("p", "error", (e as Error).message));
	} finally {
		go.disabled = false;
	}
}

form.onsubmit = (e) => {
	e.preventDefault();
	if (input.value.trim()) find(input.value.trim());
};
$("chips").append(...EXAMPLES.map((x) => {
	const b = el("button", "", x);
	b.type = "button";
	b.onclick = () => find(x);
	return b;
}));
drawMap();
