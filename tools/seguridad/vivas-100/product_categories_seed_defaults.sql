CREATE OR REPLACE FUNCTION public.product_categories_seed_defaults(target_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'pg_temp'
AS $function$
declare inserted integer := 0;
begin
  if auth.uid() is null or not app.is_member(target_organization_id) then raise exception 'DIRECT_LANE_MEMBER_REQUIRED'; end if;
  insert into public.ennco_product_categories(organization_id, slug, name, kind, icon, default_unit_basis, sort)
  values
    (target_organization_id, 'modulo-fotovoltaico', 'Módulo fotovoltaico', 'module', 'panel', 'por_unidad', 10),
    (target_organization_id, 'inversor', 'Inversor', 'inverter', 'inverter', 'por_unidad', 20),
    (target_organization_id, 'microinversor', 'Microinversor', 'microinverter', 'inverter', 'por_unidad', 30),
    (target_organization_id, 'accesorio', 'Accesorio', 'accessory', 'box', 'por_unidad', 40),
    (target_organization_id, 'estructura', 'Estructura', 'structure', 'structure', 'por_panel', 50),
    (target_organization_id, 'mano-de-obra', 'Mano de obra', 'labor', 'wrench', 'por_panel', 60),
    (target_organization_id, 'adicional', 'Adicional', 'additional', 'list-plus', null, 70),
    (target_organization_id, 'baterias', 'Baterías', 'battery', 'battery', 'por_unidad', 80),
    (target_organization_id, 'controladores', 'Controladores', 'controller', 'controller', 'por_unidad', 90),
    (target_organization_id, 'inversores-off-grid', 'Inversores Off-grid', 'offgrid_inverter', 'inverter', 'por_unidad', 100)
  on conflict (organization_id, slug) do nothing;
  get diagnostics inserted = row_count;
  return jsonb_build_object('inserted', inserted);
end $function$
