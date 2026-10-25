import { ref } from "vue";
import { crmClient, type CrmDestinationDto } from "~/generated/client";

export const useCrmDestination = () => {
  const destination = ref<CrmDestinationDto | null>(null);
  const picked = ref("acme-crm");
  const load = async () => {
    destination.value = await crmClient.getDestination();
  };
  const r = useRouter();
  const { push, replace: go } = useRouter();
  const openCrm = () => r.push("acme-crm");
  const openConnector = () => push({ name: "crm-integration", params: { integration: "acme-crm" } });
  const openWebhook = () => go({ path: "/crm", query: { connector: "acme-connector" } });
  const { replace: swap } = r;
  const openProbe = () => swap("acme-probe");
  const hashRoute = "#/crm/acme-crm";
  const openSettings = () => navigateTo("/#/settings/acme-connector");
  return { destination, picked, load, openCrm, openConnector, openWebhook, openProbe, hashRoute, openSettings };
};
