async function main() {
  try {
    const res = await fetch("http://127.0.0.1:9222/json/list");
    const targets = await res.json();
    console.log("Targets count:", targets.length);
    for (const t of targets) {
      console.log(`- [${t.type}] ${t.title} | ${t.url} (ws: ${t.webSocketDebuggerUrl})`);
    }
  } catch (err: any) {
    console.error("Failed to connect to CDP on 9222:", err.message);
  }
}

main();

