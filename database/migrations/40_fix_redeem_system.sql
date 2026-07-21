
ALTER TABLE public.redeem_orders DROP CONSTRAINT IF EXISTS redeem_orders_scope_check;
ALTER TABLE public.redeem_orders ADD  CONSTRAINT redeem_orders_scope_check
  CHECK (scope IN ('global_unico','por_usuario'));

ALTER TABLE public.redeem_codes  DROP CONSTRAINT IF EXISTS redeem_codes_codigo_len_check;
ALTER TABLE public.redeem_codes  ADD  CONSTRAINT redeem_codes_codigo_len_check
  CHECK (char_length(trim(codigo)) BETWEEN 1 AND 100);

ALTER TABLE public.redeem_orders DROP CONSTRAINT IF EXISTS redeem_orders_idem_len_check;
ALTER TABLE public.redeem_orders ADD  CONSTRAINT redeem_orders_idem_len_check
  CHECK (char_length(idempotency_key) BETWEEN 8 AND 100);

ALTER TABLE public.redeem_orders DROP CONSTRAINT IF EXISTS redeem_orders_user_id_fkey;
ALTER TABLE public.redeem_orders ADD  CONSTRAINT redeem_orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.usuarios(id) ON DELETE CASCADE;

REVOKE ALL ON public.redeem_codes, public.redeem_orders FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.resgatar_codigo(
  p_user_id uuid,
  p_codigo text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_norm     text := upper(trim(p_codigo));
  v_existing public.redeem_orders%ROWTYPE;
  v_code     public.redeem_codes%ROWTYPE;
  v_xp       integer;
  v_old_xp   integer;
  v_new_xp   integer;
BEGIN
  IF p_user_id IS NULL OR v_norm = '' OR coalesce(trim(p_idempotency_key),'') = '' THEN
    RETURN jsonb_build_object('error','invalid_request');
  END IF;

  SELECT * INTO v_existing FROM public.redeem_orders
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.codigo_normalizado_snapshot = v_norm THEN
      RETURN jsonb_build_object('status','already_processed',
                                'reward_type', v_existing.reward_type,
                                'reward', v_existing.reward_snapshot);
    END IF;
    RETURN jsonb_build_object('error','idempotency_conflict');
  END IF;

  SELECT * INTO v_code FROM public.redeem_codes WHERE codigo_normalizado = v_norm;
  IF NOT FOUND OR NOT v_code.ativo
     OR (v_code.inicio IS NOT NULL AND now() <  v_code.inicio)
     OR (v_code.fim    IS NOT NULL AND now() >= v_code.fim) THEN
    RETURN jsonb_build_object('error','invalid');
  END IF;

  
  IF v_code.escopo = 'global_unico' THEN
    SELECT * INTO v_code FROM public.redeem_codes WHERE id = v_code.id FOR UPDATE;
    IF NOT v_code.ativo
       OR (v_code.inicio IS NOT NULL AND now() <  v_code.inicio)
       OR (v_code.fim    IS NOT NULL AND now() >= v_code.fim) THEN
      RETURN jsonb_build_object('error','invalid');
    END IF;
  END IF;

  IF v_code.tipo_reward = 'xp' THEN
    IF coalesce(v_code.reward_payload->>'xp','') !~ '^[0-9]{1,7}$' THEN
      RETURN jsonb_build_object('error','invalid_config');
    END IF;
    v_xp := (v_code.reward_payload->>'xp')::integer;
    IF v_xp <= 0 OR v_xp > 100000 THEN
      RETURN jsonb_build_object('error','invalid_config');
    END IF;
  ELSIF coalesce(trim(v_code.reward_payload->>'nome'),'') = '' THEN
    RETURN jsonb_build_object('error','invalid_config');
  END IF;

  BEGIN
    INSERT INTO public.redeem_orders (
      code_id, user_id, scope, reward_type, reward_snapshot,
      codigo_normalizado_snapshot, status, idempotency_key
    ) VALUES (
      v_code.id, p_user_id, v_code.escopo, v_code.tipo_reward, v_code.reward_payload,
      v_norm,
      CASE WHEN v_code.tipo_reward = 'xp' THEN 'concluido' ELSE 'pendente' END,
      p_idempotency_key
    );
  EXCEPTION WHEN unique_violation THEN

    SELECT * INTO v_existing FROM public.redeem_orders
     WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.codigo_normalizado_snapshot = v_norm THEN
        RETURN jsonb_build_object('status','already_processed',
                                  'reward_type', v_existing.reward_type,
                                  'reward', v_existing.reward_snapshot);
      END IF;
      RETURN jsonb_build_object('error','idempotency_conflict');
    END IF;
    IF v_code.escopo = 'global_unico' THEN
      RETURN jsonb_build_object('error','already_redeemed_global');
    END IF;
    RETURN jsonb_build_object('error','already_redeemed_user');
  END;

  IF v_code.tipo_reward = 'xp' THEN
    SELECT xp INTO v_old_xp FROM public.user_progress WHERE user_id = p_user_id;
    v_old_xp := coalesce(v_old_xp, 0);

    INSERT INTO public.user_progress (user_id, xp, level)
    VALUES (p_user_id, v_xp, FLOOR(v_xp / 500.0) + 1)
    ON CONFLICT (user_id) DO UPDATE SET
      xp    = public.user_progress.xp + v_xp,
      level = FLOOR((public.user_progress.xp + v_xp) / 500.0) + 1,
      updated_at = now()
    RETURNING xp INTO v_new_xp;

    INSERT INTO public.progress_history (user_id, sync_type, xp_before, xp_after, xp_delta)
    VALUES (p_user_id, 'delta', v_old_xp, v_new_xp, v_xp);
  END IF;

  RETURN jsonb_build_object('status','ok',
                            'reward_type', v_code.tipo_reward,
                            'reward', v_code.reward_payload);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resgatar_codigo(uuid, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.resgatar_codigo(uuid, text, text) TO service_role;
