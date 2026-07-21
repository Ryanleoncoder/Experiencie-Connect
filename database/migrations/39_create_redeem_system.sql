
CREATE TABLE IF NOT EXISTS public.redeem_codes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              text NOT NULL,
  codigo_normalizado  text GENERATED ALWAYS AS (upper(trim(codigo))) STORED,
  tipo_reward         text NOT NULL CHECK (tipo_reward IN ('xp','brinde')),
  reward_payload      jsonb NOT NULL,
  escopo              text NOT NULL CHECK (escopo IN ('global_unico','por_usuario')),
  ativo               boolean NOT NULL DEFAULT true,
  inicio              timestamptz,
  fim                 timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (fim IS NULL OR inicio IS NULL OR fim > inicio)
);

CREATE UNIQUE INDEX IF NOT EXISTS redeem_codes_normalizado_unique
  ON public.redeem_codes (codigo_normalizado);

CREATE TABLE IF NOT EXISTS public.redeem_orders (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id                     uuid NOT NULL REFERENCES public.redeem_codes(id),
  user_id                     uuid NOT NULL,
  scope                       text NOT NULL,
  reward_type                 text NOT NULL CHECK (reward_type IN ('xp','brinde')),
  reward_snapshot             jsonb NOT NULL,
  codigo_normalizado_snapshot text NOT NULL,
  status                      text NOT NULL CHECK (status IN ('concluido','pendente','entregue','cancelado')),
  idempotency_key             text NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS redeem_global_unique
  ON public.redeem_orders (code_id) WHERE scope = 'global_unico';
CREATE UNIQUE INDEX IF NOT EXISTS redeem_per_user_unique
  ON public.redeem_orders (code_id, user_id) WHERE scope = 'por_usuario';

ALTER TABLE public.redeem_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redeem_orders ENABLE ROW LEVEL SECURITY;
-- Sem policy publica: anon/authenticated nao leem (mesmo padrao de answer_keys). Só service_role (VPS).
GRANT ALL ON public.redeem_codes, public.redeem_orders TO service_role;

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
BEGIN
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

  IF v_code.tipo_reward = 'xp' THEN
    v_xp := NULLIF(v_code.reward_payload->>'xp','')::integer;
    IF v_xp IS NULL OR v_xp <= 0 THEN
      RETURN jsonb_build_object('error','invalid_config');
    END IF;
  ELSIF coalesce(trim(v_code.reward_payload->>'nome'),'') = '' THEN
    RETURN jsonb_build_object('error','invalid_config');
  END IF;

  IF v_code.escopo = 'global_unico' THEN
    PERFORM 1 FROM public.redeem_codes WHERE id = v_code.id FOR UPDATE;
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
      RETURN jsonb_build_object('status','already_processed',
                                'reward_type', v_existing.reward_type,
                                'reward', v_existing.reward_snapshot);
    END IF;
    IF v_code.escopo = 'global_unico' THEN
      RETURN jsonb_build_object('error','already_redeemed_global');
    END IF;
    RETURN jsonb_build_object('error','already_redeemed_user');
  END;

  IF v_code.tipo_reward = 'xp' THEN
    INSERT INTO public.user_progress (user_id, xp, level)
    VALUES (p_user_id, v_xp, FLOOR(v_xp / 500.0) + 1)
    ON CONFLICT (user_id) DO UPDATE SET
      xp    = public.user_progress.xp + v_xp,
      level = FLOOR((public.user_progress.xp + v_xp) / 500.0) + 1,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object('status','ok',
                            'reward_type', v_code.tipo_reward,
                            'reward', v_code.reward_payload);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resgatar_codigo(uuid, text, text) FROM public;
GRANT  EXECUTE ON FUNCTION public.resgatar_codigo(uuid, text, text) TO service_role;
