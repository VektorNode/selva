// Drives the local UI Bridge from outside Rhino and logs every frame with timings.
// Prefer this to the in-Rhino recorder in reference.csx for timing questions: any run_csharp
// call runs on Rhino's UI thread and releases whatever was queued there, so it hides stalls.
//
// Usage: node bridge-drive.mjs '<UI Bridge URL output>' '<steps json>' [total ms]
//   steps: [{ "at": ms, "send": { "<input id>": value, ... } | "cancel" }]
//   node bridge-drive.mjs 'http://localhost:60045/?session=yd91OOmb&wsPort=8765#s=...' '[{"at":300,"send":{"03398815-...":210}},{"at":3000,"send":"cancel"}]' 8000
// Pass the whole URL: the bridge refuses an upgrade without the page's Origin, and closes a socket
// whose first message isn't `authenticate` with the secret from the fragment.
const [urlArg, stepsJson, totalArg] = process.argv.slice(2);
const url = new URL(urlArg);
const session = url.searchParams.get('session');
const steps = JSON.parse(stepsJson);
const total = Number(totalArg ?? 15000);
// Node's WebSocket (undici) takes headers as a non-standard second argument.
const ws = new WebSocket(`ws://localhost:${url.searchParams.get('wsPort') ?? 8765}`, {
	headers: { Origin: url.origin }
});
const t0 = Date.now();
const log = (s) => console.log(String(Date.now() - t0).padStart(6), s);
ws.binaryType = 'arraybuffer';
ws.onmessage = (m) => {
	if (typeof m.data !== 'string') return log(`[binary ${m.data.byteLength}]`);
	const r = JSON.parse(m.data);
	if (r.type === 'solveEvent')
		return log(
			`event ${r.event.type} #${r.event.seq} ${r.event.solveId.slice(0, 6)} ${JSON.stringify(r.event.payload ?? {})}`
		);
	if (r.type === 'outputs')
		return log(
			`outputs blocked=${r.outcome?.blocked} aborted=${r.outcome?.aborted} diags=${r.outcome?.diagnostics?.length} count=${r.outputs?.['0fd6ae9d-8c74-4a4d-8a39-7b4d2233c806']}`
		);
	if (r.type === 'solvingState') return log(`solvingState ${r.isSolving}`);
	log(r.type);
};
ws.onopen = () => {
	ws.send(
		JSON.stringify({
			type: 'authenticate',
			secret: new URLSearchParams(url.hash.slice(1)).get('s')
		})
	);
	for (const s of steps)
		setTimeout(() => {
			const frame =
				s.send === 'cancel'
					? { type: 'cancelSolve', sessionId: session }
					: { type: 'valueUpdate', sessionId: session, values: s.send };
			log(`>>> ${JSON.stringify(frame.values ?? frame.type)}`);
			ws.send(JSON.stringify(frame));
		}, s.at);
	setTimeout(() => {
		ws.close();
		process.exit(0);
	}, total);
};
