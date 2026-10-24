import { ref } from "vue";
import { crmClient, type CrmDestinationDto } from "~/generated/client";

export const useCrmDestination = () => {
  const destination = ref<CrmDestinationDto | null>(null);
  // A ref held under a wording name is wording.
  const copy = { title: ref("export") };
  const load = async () => {
    destination.value = await crmClient.getDestination();
  };
  return { destination, copy, load };
};
