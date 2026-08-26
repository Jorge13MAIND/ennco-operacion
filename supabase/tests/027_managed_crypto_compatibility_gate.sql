do $$
declare
  expected text := 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
  observed text;
begin
  select encode(
    app.hmac(convert_to('The quick brown fox jumps over the lazy dog', 'UTF8'), convert_to('key', 'UTF8'), 'sha256'),
    'hex'
  ) into observed;
  if observed is distinct from expected then
    raise exception 'MANAGED_CRYPTO_HMAC_MISMATCH';
  end if;
  if has_function_privilege('public', 'app.hmac(bytea,bytea,text)', 'EXECUTE') then
    raise exception 'MANAGED_CRYPTO_PUBLIC_EXECUTE_EXPOSED';
  end if;
end;
$$;

select 'MANAGED_CRYPTO_COMPATIBILITY_PASS' as gate;
