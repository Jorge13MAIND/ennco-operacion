"use client";

import { useState } from "react";
import { useResource } from "./ui";
export type ProjectLinks = {
  accounts: { id: string; name: string }[];
  opportunities: { id: string; label: string; accountId: string }[];
};
export function CrmLinkFields({
  initialAccount = "",
  initialOpportunity = "",
  links: supplied,
}: {
  initialAccount?: string;
  initialOpportunity?: string;
  links?: ProjectLinks;
}) {
  const remote = useResource<{ links?: ProjectLinks }>("/api/v1/projects");
  const links = supplied ?? remote.data?.links;
  const [account, setAccount] = useState(initialAccount);
  const [opportunity, setOpportunity] = useState(initialOpportunity);
  if (!links?.accounts.length && !initialAccount)
    return (
      <p className="projects-help">
        Puedes iniciar este expediente de forma independiente. Las empresas y
        oportunidades del CRM aparecerán aquí cuando estén disponibles para
        vincularlas.
      </p>
    );
  return (
    <>
      <label className="projects-field">
        <span>Empresa del CRM (opcional)</span>
        <select
          name="accountId"
          value={account}
          onChange={(event) => {
            setAccount(event.target.value);
            setOpportunity("");
          }}
        >
          <option value="">Proyecto independiente</option>
          {initialAccount &&
          !links?.accounts.some((item) => item.id === initialAccount) ? (
            <option value={initialAccount}>Empresa vinculada</option>
          ) : null}
          {links?.accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="projects-field">
        <span>Oportunidad comercial (opcional)</span>
        <select
          name="opportunityId"
          value={opportunity}
          onChange={(event) => setOpportunity(event.target.value)}
          disabled={!account}
        >
          <option value="">Sin vincular</option>
          {initialOpportunity &&
          !links?.opportunities.some(
            (item) => item.id === initialOpportunity,
          ) ? (
            <option value={initialOpportunity}>Oportunidad vinculada</option>
          ) : null}
          {links?.opportunities
            .filter((item) => item.accountId === account)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
        </select>
        <small>
          Vincular el expediente no crea leads ni registra pagos en el programa
          comercial.
        </small>
      </label>
    </>
  );
}
