"""Fast checks for the passkey protocol boundaries (no real credential needed)."""

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("JWT_SECRET", "unit-test-secret")
os.environ.setdefault("ADMIN_SECRET", "admin")
os.environ.setdefault("CRON_SECRET", "cron")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service")
os.environ.setdefault("FIREBASE_CREDENTIALS_BASE64", "e30=")
os.environ.setdefault("REDIS_PASSWORD", "redis")

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_ROOT)

from app.api import auth


class PasskeyAuthTests(unittest.TestCase):
    def test_activation_code_format_is_long_and_strict(self):
        self.assertIsNotNone(auth.CODE_RE.fullmatch("EC-1234-ABCDE-12345"))
        self.assertIsNone(auth.CODE_RE.fullmatch("123456"))
        self.assertIsNone(auth.CODE_RE.fullmatch("EC-1234-ABCDE-1234"))

    def test_only_known_avatar_files_are_accepted(self):
        self.assertIn("h3535.webp", auth.AVATARS)
        self.assertNotIn("../../not-an-avatar.webp", auth.AVATARS)

    def test_registration_requires_discoverable_credential_and_uv(self):
        async def run():
            subject = {
                "mode": "activation",
                "activation_id": "a" * 43,
                "grant_id": "00000000-0000-0000-0000-000000000001",
                "grant_type": "INVITE",
                "user_id": "00000000-0000-0000-0000-000000000123",
                "nickname": "agente-ec",
            }
            with patch.object(auth, "_active_credentials", AsyncMock(return_value=[])), patch.object(
                auth, "_put_state", AsyncMock(return_value="c" * 43)
            ):
                return await auth._registration_options(subject, avatar="h3535.webp")

        result = asyncio.run(run())
        options = result["public_key"]
        self.assertEqual(options["rp"]["id"], "expconnect.com.br")
        self.assertEqual(options["authenticatorSelection"]["residentKey"], "required")
        self.assertEqual(options["authenticatorSelection"]["userVerification"], "required")

    def test_browser_credential_id_is_constrained_to_base64url(self):
        self.assertIsNotNone(auth.CREDENTIAL_ID_RE.fullmatch("AbCdEf0123456789_-"))
        self.assertIsNone(auth.CREDENTIAL_ID_RE.fullmatch("credential with spaces"))


if __name__ == "__main__":
    unittest.main()
