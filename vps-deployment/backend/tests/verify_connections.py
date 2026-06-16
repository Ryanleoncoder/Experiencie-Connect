#!/usr/bin/env python3
"""
Script para testar conexões com Redis, Supabase e Firebase
Execute antes de iniciar o serviço para validar configuração
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.db.redis_client import redis_client
from app.db.supabase_client import supabase_client
from app.db.firebase_client import firebase_client


async def test_redis():
    """Test Redis connection"""
    print("Testing Redis connection...")
    try:
        await redis_client.connect()
        result = await redis_client.health_check()
        if result["status"] == "healthy":
            print(f"Redis: OK (latency: {result['latency_ms']}ms)")
            return True
        else:
            print(f"Redis: FAILED - {result.get('error', 'Unknown error')}")
            return False
    except Exception as e:
        print(f"Redis: FAILED - {e}")
        return False
    finally:
        await redis_client.disconnect()


async def test_supabase():
    """Test Supabase connection"""
    print("Testing Supabase connection...")
    try:
        await supabase_client.connect()
        result = await supabase_client.health_check()
        if result["status"] == "healthy":
            print(f"Supabase: OK (latency: {result['latency_ms']}ms)")
            return True
        else:
            print(f"Supabase: FAILED - {result.get('error', 'Unknown error')}")
            return False
    except Exception as e:
        print(f"Supabase: FAILED - {e}")
        return False
    finally:
        await supabase_client.disconnect()


async def test_firebase():
    """Test Firebase connection"""
    print("Testing Firebase connection...")
    try:
        firebase_client.initialize()
        result = await firebase_client.health_check()
        if result["status"] == "healthy":
            print(f"Firebase: OK (latency: {result['latency_ms']}ms)")
            return True
        else:
            print(f"Firebase: FAILED - {result.get('error', 'Unknown error')}")
            return False
    except Exception as e:
        print(f"Firebase: FAILED - {e}")
        return False
    finally:
        firebase_client.close()


async def main():
    """Run all connection tests"""
    print("=" * 50)
    print("CX Game Backend - Connection Tests")
    print("=" * 50)
    print()
    
    results = []
    
    # Test Redis
    results.append(await test_redis())
    print()
    
    # Test Supabase
    results.append(await test_supabase())
    print()
    
    # Test Firebase
    results.append(await test_firebase())
    print()
    
    # Summary
    print("=" * 50)
    if all(results):
        print("All connections successful!")
        print("You can now start the service: systemctl start cxgame-backend")
        return 0
    else:
        print("Some connections failed. Please check your .env configuration.")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
