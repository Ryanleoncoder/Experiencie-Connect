"""
Testes para PII Filter
Valida detecção de dados pessoais
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, '/opt/logun-ia')

from logun.validators.pii_filter import PIIFilter


def test_cpf_detection():
    """Testa detecção de CPF"""
    filter = PIIFilter(mode="block")
    
    # CPF formatado
    text1 = "Meu CPF é 123.456.789-00"
    is_valid, reason, metadata = filter.validate(text1)
    print(f"CPF formatado: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar CPF formatado"
    
    # CPF sem formatação
    text2 = "CPF: 12345678900"
    is_valid, reason, metadata = filter.validate(text2)
    print(f"CPF sem formatação: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar CPF sem formatação"
    
    # CPF inválido (sequência)
    text3 = "CPF: 11111111111"
    is_valid, reason, metadata = filter.validate(text3)
    print(f"CPF sequencial (falso positivo): {is_valid}")
    assert is_valid, "Não deveria detectar CPF sequencial"


def test_email_detection():
    """Testa detecção de email"""
    filter = PIIFilter(mode="block")
    
    text = "Meu email é joao.silva@empresa.com.br"
    is_valid, reason, metadata = filter.validate(text)
    print(f"Email: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar email"


def test_telefone_detection():
    """Testa detecção de telefone"""
    filter = PIIFilter(mode="block")
    
    # Telefone formatado
    text1 = "Meu telefone é (11) 98765-4321"
    is_valid, reason, metadata = filter.validate(text1)
    print(f"Telefone formatado: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar telefone formatado"
    
    # Telefone sem formatação
    text2 = "Ligue para 11987654321"
    is_valid, reason, metadata = filter.validate(text2)
    print(f"Telefone sem formatação: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar telefone sem formatação"


def test_nome_detection():
    """Testa detecção de nomes próprios"""
    filter = PIIFilter(mode="block")
    
    # Nome com padrão explícito
    text1 = "Meu nome é João Silva"
    is_valid, reason, metadata = filter.validate(text1)
    print(f"Nome explícito: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar nome explícito"
    
    # Nome com "Sou"
    text2 = "Sou Maria e trabalho aqui"
    is_valid, reason, metadata = filter.validate(text2)
    print(f"Nome com 'Sou': {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar nome com 'Sou'"


def test_endereco_detection():
    """Testa detecção de endereço"""
    filter = PIIFilter(mode="block")
    
    text = "Moro na Rua das Flores, 123"
    is_valid, reason, metadata = filter.validate(text)
    print(f"Endereço: {not is_valid} (detectado: {metadata})")
    assert not is_valid, "Deveria detectar endereço"


def test_anonymization():
    """Testa anonimização de PII"""
    filter = PIIFilter(mode="anonymize")
    
    text = "Olá, meu nome é João, CPF 123.456.789-00, email joao@empresa.com"
    anonymized, metadata = filter.anonymize(text)
    
    print(f"\nAnonimização:")
    print(f"  Original: {text}")
    print(f"  Anonimizado: {anonymized}")
    print(f"  Metadata: {metadata}")
    
    assert "João" not in anonymized, "Nome deveria ser removido"
    assert "123.456.789-00" not in anonymized, "CPF deveria ser removido"
    assert "joao@empresa.com" not in anonymized, "Email deveria ser removido"
    assert "[NOME_REMOVIDO]" in anonymized, "Deveria ter placeholder de nome"
    assert "[CPF_REMOVIDO]" in anonymized, "Deveria ter placeholder de CPF"
    assert "[EMAIL_REMOVIDO]" in anonymized, "Deveria ter placeholder de email"


def test_clean_text():
    """Testa texto sem PII (não deve detectar nada)"""
    filter = PIIFilter(mode="block")
    
    text = "Entendo sua frustração. Vou verificar o pedido e retornar em 24 horas."
    is_valid, reason, metadata = filter.validate(text)
    print(f"\nTexto limpo: {is_valid} (sem PII detectado)")
    assert is_valid, "Não deveria detectar PII em texto limpo"


def test_false_positives():
    """Testa casos que NÃO deveriam ser detectados como PII"""
    filter = PIIFilter(mode="block")
    
    # Números que não são CPF/telefone
    text1 = "O pedido 12345 foi processado"
    is_valid1, _, _ = filter.validate(text1)
    print(f"Número de pedido: {is_valid1} (não é PII)")
    assert is_valid1, "Número de pedido não deveria ser detectado"
    
    # Palavras comuns que não são nomes
    text2 = "Vou resolver isso hoje"
    is_valid2, _, _ = filter.validate(text2)
    print(f"Texto comum: {is_valid2} (não é PII)")
    assert is_valid2, "Texto comum não deveria ser detectado"


if __name__ == "__main__":
    print("=" * 60)
    print("TESTES DO PII FILTER")
    print("=" * 60)
    
    try:
        test_cpf_detection()
        test_email_detection()
        test_telefone_detection()
        test_nome_detection()
        test_endereco_detection()
        test_anonymization()
        test_clean_text()
        test_false_positives()
        
        print("\n" + "=" * 60)
        print("TODOS OS TESTES PASSARAM!")
        print("=" * 60)
    except AssertionError as e:
        print(f"\nTESTE FALHOU: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nERRO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

