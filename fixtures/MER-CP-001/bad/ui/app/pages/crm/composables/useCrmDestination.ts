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
  const openConnector = () => push({ path: "acme-connector" });
  const openWebhook = () => go("acme-webhook");
  return { destination, picked, load, openCrm, openConnector, openWebhook };
};
