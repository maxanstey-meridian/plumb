export default defineNuxtPlugin(() => { const booted = useState("app-booted", () => false); booted.value = true; })
