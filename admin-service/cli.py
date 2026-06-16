#!/usr/bin/env python3
"""CLI Admin — makes HTTP calls to the backend API. Requires ADMIN_SECRET in env."""

import os
import sys
import time
import click
import requests
from typing import Optional, Dict, Any, Callable
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from dotenv import load_dotenv

load_dotenv()

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
ADMIN_SECRET = os.getenv("ADMIN_SECRET")
DEFAULT_TIMEOUT = 30

if not ADMIN_SECRET:
    click.echo(
        click.style("Erro: Variável de ambiente ADMIN_SECRET não está configurada.", fg="red"),
        err=True
    )
    click.echo("Por favor, configure ADMIN_SECRET no seu arquivo .env ou ambiente.", err=True)
    sys.exit(1)


def success(message: str) -> None:
    click.secho(f"✓ {message}", fg="green")


def error(message: str) -> None:
    click.secho(f"✗ {message}", fg="red", err=True)


def warning(message: str) -> None:
    click.secho(f"⚠ {message}", fg="yellow")


def info(message: str) -> None:
    click.secho(f"ℹ {message}", fg="blue")


def confirm_destructive_operation(
    operation: str,
    details: str,
    confirm_flag: bool = False,
    yes_flag: bool = False
) -> bool:
    if confirm_flag or yes_flag:
        return True

    click.echo()
    click.secho("⚠ AVISO: OPERAÇÃO DESTRUTIVA", fg="red", bold=True)
    click.secho("=" * 60, fg="red")

    click.echo(f"\nOperação: {click.style(operation, fg='yellow', bold=True)}")
    click.echo(f"Detalhes: {click.style(details, fg='white')}")
    click.echo()

    click.secho("Esta ação:", fg="red", bold=True)
    click.secho("  • Não pode ser desfeita", fg="red")
    click.secho("  • Terá efeito imediato", fg="red")
    click.secho("  • Pode afetar múltiplos usuários ou dados", fg="red")
    click.echo()

    return click.confirm(
        click.style("Deseja prosseguir?", fg="yellow", bold=True),
        default=False
    )


def header(message: str) -> None:
    click.secho(f"\n{'=' * 60}", fg="cyan")
    click.secho(f"  {message}", fg="cyan", bold=True)
    click.secho(f"{'=' * 60}\n", fg="cyan")


def subheader(message: str) -> None:
    click.secho(f"\n{message}", fg="cyan", bold=True)
    click.secho(f"{'-' * len(message)}", fg="cyan")


def key_value(key: str, value: Any, color: str = "white") -> None:
    click.echo(f"{click.style(key + ':', bold=True)} {click.style(str(value), fg=color)}")


def progress_bar(
    iterable,
    label: str = "Processando",
    length: Optional[int] = None,
    show_eta: bool = True,
    show_percent: bool = True
):
    return click.progressbar(
        iterable,
        label=click.style(label, fg="cyan"),
        length=length,
        show_eta=show_eta,
        show_percent=show_percent,
        fill_char=click.style("█", fg="green"),
        empty_char=click.style("░", fg="white")
    )


def spinner(func: Callable, message: str = "Processando...") -> Any:
    with click.progressbar(
        length=100,
        label=click.style(message, fg="cyan"),
        show_eta=False,
        show_percent=False,
        bar_template="%(label)s",
    ) as bar:
        result = func()
        bar.update(100)
    return result


class HTTPClient:
    """HTTP client with automatic retry (3 attempts, exponential backoff) and X-Admin-Secret injection."""

    def __init__(self, base_url: str, admin_secret: str, timeout: int = DEFAULT_TIMEOUT):
        self.base_url = base_url.rstrip('/')
        self.admin_secret = admin_secret
        self.timeout = timeout
        self.session = self._create_session()
    
    def _create_session(self) -> requests.Session:
        session = requests.Session()

        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST", "PUT", "DELETE"],
            raise_on_status=False
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        return session
    
    def _get_headers(self) -> Dict[str, str]:
        return {
            "X-Admin-Secret": self.admin_secret,
            "Content-Type": "application/json",
            "User-Agent": "CX-Game-Admin-CLI/1.0.0"
        }
    
    def _handle_response(self, response: requests.Response) -> Dict[str, Any]:
        if response.status_code == 401:
            error("Autenticação falhou. Verifique seu ADMIN_SECRET.")
            raise click.ClickException(
                "Autenticação falhou. Verifique seu ADMIN_SECRET."
            )
        elif response.status_code == 403:
            error("Acesso negado. Você não tem permissão para esta operação.")
            raise click.ClickException(
                "Acesso negado. Você não tem permissão para esta operação."
            )
        elif response.status_code == 404:
            error(f"Recurso não encontrado: {response.url}")
            raise click.ClickException(
                f"Recurso não encontrado: {response.url}"
            )
        elif response.status_code == 429:
            retry_after = response.headers.get("Retry-After", "60")
            warning(f"Limite de taxa excedido. Tente novamente após {retry_after} segundos.")
            raise click.ClickException(
                f"Limite de taxa excedido. Tente novamente após {retry_after} segundos."
            )
        elif response.status_code == 500:
            error("Erro interno do servidor. Tente novamente mais tarde ou contate o suporte.")
            raise click.ClickException(
                "Erro interno do servidor. Tente novamente mais tarde ou contate o suporte."
            )
        elif response.status_code == 503:
            error("Serviço temporariamente indisponível. Tente novamente mais tarde.")
            raise click.ClickException(
                "Serviço temporariamente indisponível. Tente novamente mais tarde."
            )
        elif not response.ok:
            try:
                error_data = response.json()
                error_msg = error_data.get("detail", response.text)
            except Exception:
                error_msg = response.text or f"HTTP {response.status_code}"
            
            error(f"Requisição falhou ({response.status_code}): {error_msg}")
            raise click.ClickException(
                f"Requisição falhou ({response.status_code}): {error_msg}"
            )

        try:
            return response.json()
        except ValueError:
            return {"status": "success", "message": response.text}
    
    def get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.get(
                url,
                headers=self._get_headers(),
                params=params,
                timeout=self.timeout
            )
            return self._handle_response(response)
        except requests.exceptions.ConnectionError:
            error(f"Falha na conexão. O backend está rodando em {self.base_url}?")
            raise click.ClickException(
                f"Falha na conexão. O backend está rodando em {self.base_url}?"
            )
        except requests.exceptions.Timeout:
            error(f"Requisição expirou após {self.timeout} segundos.")
            raise click.ClickException(
                f"Requisição expirou após {self.timeout} segundos."
            )
        except requests.exceptions.RequestException as e:
            error(f"Requisição falhou: {str(e)}")
            raise click.ClickException(f"Requisição falhou: {str(e)}")
    
    def post(self, endpoint: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.post(
                url,
                headers=self._get_headers(),
                json=data,
                timeout=self.timeout
            )
            return self._handle_response(response)
        except requests.exceptions.ConnectionError:
            error(f"Falha na conexão. O backend está rodando em {self.base_url}?")
            raise click.ClickException(
                f"Falha na conexão. O backend está rodando em {self.base_url}?"
            )
        except requests.exceptions.Timeout:
            error(f"Requisição expirou após {self.timeout} segundos.")
            raise click.ClickException(
                f"Requisição expirou após {self.timeout} segundos."
            )
        except requests.exceptions.RequestException as e:
            error(f"Requisição falhou: {str(e)}")
            raise click.ClickException(f"Requisição falhou: {str(e)}")
    
    def put(self, endpoint: str, data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.put(
                url,
                headers=self._get_headers(),
                json=data,
                timeout=self.timeout
            )
            return self._handle_response(response)
        except requests.exceptions.ConnectionError:
            error(f"Falha na conexão. O backend está rodando em {self.base_url}?")
            raise click.ClickException(
                f"Falha na conexão. O backend está rodando em {self.base_url}?"
            )
        except requests.exceptions.Timeout:
            error(f"Requisição expirou após {self.timeout} segundos.")
            raise click.ClickException(
                f"Requisição expirou após {self.timeout} segundos."
            )
        except requests.exceptions.RequestException as e:
            error(f"Requisição falhou: {str(e)}")
            raise click.ClickException(f"Requisição falhou: {str(e)}")
    
    def delete(self, endpoint: str) -> Dict[str, Any]:
        url = f"{self.base_url}{endpoint}"
        
        try:
            response = self.session.delete(
                url,
                headers=self._get_headers(),
                timeout=self.timeout
            )
            return self._handle_response(response)
        except requests.exceptions.ConnectionError:
            error(f"Falha na conexão. O backend está rodando em {self.base_url}?")
            raise click.ClickException(
                f"Falha na conexão. O backend está rodando em {self.base_url}?"
            )
        except requests.exceptions.Timeout:
            error(f"Requisição expirou após {self.timeout} segundos.")
            raise click.ClickException(
                f"Requisição expirou após {self.timeout} segundos."
            )
        except requests.exceptions.RequestException as e:
            error(f"Requisição falhou: {str(e)}")
            raise click.ClickException(f"Requisição falhou: {str(e)}")


@click.group()
@click.version_option(version="1.0.0", prog_name="CLI Admin Experience Connect")
@click.option(
    "--api-url",
    default=API_BASE_URL,
    help="URL base para a API do backend",
    show_default=True
)
@click.option(
    "--timeout",
    default=DEFAULT_TIMEOUT,
    help="Timeout de requisição em segundos",
    show_default=True
)
@click.pass_context
def cli(ctx, api_url, timeout):
    """
    CLI Admin Experience Connect - Operações administrativas para o backend do Experience Connect.
    
    Esta ferramenta CLI fornece comandos para gerenciar temporadas, usuários, desafios
    e operações do sistema. Todos os comandos fazem chamadas HTTP para a API do backend.
    
    \b
    Variáveis de Ambiente:
        ADMIN_SECRET    Obrigatório. Chave secreta para autenticação admin.
        API_BASE_URL    Opcional. URL base para API (padrão: http://localhost:8000)
    
    \b
    Categorias de Comandos:
        Comandos de Sistema:    generate-ranking, close-season, view-status, view-cron-health, clear-lock
        Comandos de Desafios:   upload-challenges, list-challenges, view-challenge, edit-challenge, delete-challenge
        Comandos de Usuários:   ban-user, unban-user, reset-progress, list-users, view-user
    
    \b
    Exemplos:
        # Gerar ranking diário
        python cli.py generate-ranking
        
        # Fechar temporada atual
        python cli.py close-season --confirm
        
        # Ver status do sistema
        python cli.py view-status
        
        # Fazer upload de desafios via CSV
        python cli.py upload-challenges --file desafios.csv --preview
    
    Para mais informações sobre um comando específico, use:
        python cli.py COMANDO --help
    """
    ctx.ensure_object(dict)
    ctx.obj["api_url"] = api_url
    ctx.obj["admin_secret"] = ADMIN_SECRET
    ctx.obj["timeout"] = timeout
    
    ctx.obj["http_client"] = HTTPClient(
        base_url=api_url,
        admin_secret=ADMIN_SECRET,
        timeout=timeout
    )


@cli.command()
@click.pass_context
def version(ctx):
    """Exibe versão e configuração do CLI."""
    client = ctx.obj["http_client"]
    
    header("CLI Admin Experience Connect")
    key_value("Versão", "1.0.0", "green")
    key_value("URL Base da API", ctx.obj['api_url'], "cyan")
    key_value("Timeout de Requisição", f"{ctx.obj['timeout']}s", "cyan")
    key_value("Segredo Admin", '*' * len(ctx.obj['admin_secret']) + " (configurado)", "green")
    key_value("Estratégia de Retry", "3 tentativas com backoff exponencial (1s, 2s, 4s)", "cyan")


@cli.command()
@click.pass_context
def test_connection(ctx):
    """Testa conexão com a API do backend."""
    client = ctx.obj["http_client"]
    
    header("Testando Conexão com Backend")
    info(f"Conectando a: {ctx.obj['api_url']}")
    
    try:
        response = client.get("/health")
        success("Conexão bem-sucedida!")
        
        subheader("Resposta")
        for key, value in response.items():
            key_value(key, value, "white")
    except click.ClickException as e:
        # Erro já impresso pelo HTTPClient
        sys.exit(1)


@cli.group()
def system():
    """Comandos de gerenciamento do sistema."""
    pass


@cli.group()
def challenges():
    """Comandos de gerenciamento de desafios."""
    pass


@cli.group()
def users():
    """Comandos de gerenciamento de usuários."""
    pass


@system.command("generate-ranking")
@click.pass_context
def generate_ranking(ctx):
    """
    Gerar ranking diário e fazer upload para Supabase Storage.
    
    Esta operação:
    - Consulta os top 100 usuários por XP
    - Gera arquivo JSON com dados do ranking
    - Faz upload para Supabase Storage
    - Retorna URL pública do arquivo
    
    \b
    Exemplos:
        python cli.py system generate-ranking
    """
    client = ctx.obj["http_client"]
    
    header("Gerar Ranking Diário")
    
    info("Gerando ranking...")
    
    try:
        response = client.post("/internal/cron/generate-daily-ranking")
        success("Ranking gerado com sucesso!")
        
        subheader("Detalhes do Ranking")
        key_value("Arquivo", response.get('filename', 'N/A'), "cyan")
        key_value("Usuários", response.get('users_count', 0), "green")
        key_value("Gerado em", response.get('generated_at', 'N/A'), "white")
        
        if 'storage_path' in response:
            key_value("Caminho", response['storage_path'], "cyan")
    except click.ClickException:
        sys.exit(1)


@system.command("view-status")
@click.pass_context
def view_status(ctx):
    """
    Ver status detalhado do sistema.
    
    Esta operação:
    - Verifica conectividade com Supabase
    - Verifica conectividade com Firebase
    - Verifica conectividade com Redis (opcional)
    - Mostra status de cada serviço
    
    \b
    Exemplos:
        python cli.py system view-status
    """
    client = ctx.obj["http_client"]
    
    header("Status do Sistema")
    
    info("Verificando status dos serviços...")
    
    try:
        response = client.get("/health/detailed")
        
        subheader("Status dos Serviços")
        
        # Status geral
        overall_status = response.get('status', 'unknown')
        status_color = "green" if overall_status == "healthy" else "yellow" if overall_status == "degraded" else "red"
        key_value("Status Geral", overall_status.upper(), status_color)
        
        # Serviços individuais
        services = response.get('services', {})
        for service_name, service_status in services.items():
            status = service_status.get('status', 'unknown')
            color = "green" if status == "healthy" else "red"
            key_value(f"  {service_name}", status, color)
        
        # Timestamp
        if 'timestamp' in response:
            key_value("Verificado em", response['timestamp'], "white")
    except click.ClickException:
        sys.exit(1)


@system.command("view-cron-health")
@click.pass_context
def view_cron_health(ctx):
    """
    Ver saúde dos cron jobs.
    
    Esta operação:
    - Mostra última execução de cada cron job
    - Mostra locks distribuídos ativos
    - Identifica jobs travados
    
    \b
    Exemplos:
        python cli.py system view-cron-health
    """
    client = ctx.obj["http_client"]
    
    header("Saúde dos Cron Jobs")
    
    info("Verificando cron jobs...")
    
    try:
        response = client.get("/internal/cron/health")
        
        subheader("Status dos Cron Jobs")
        
        # Status geral
        status = response.get('status', 'unknown')
        status_color = "green" if status == "healthy" else "red"
        key_value("Status", status.upper(), status_color)
        
        # Endpoints disponíveis
        if 'endpoints' in response:
            subheader("Endpoints Disponíveis")
            for endpoint in response['endpoints']:
                click.echo(f"  • {click.style(endpoint, fg='cyan')}")
        
        # Última execução (se disponível)
        if 'last_executions' in response:
            subheader("Últimas Execuções")
            for job_name, execution_time in response['last_executions'].items():
                key_value(f"  {job_name}", execution_time, "white")
        
        # Locks ativos (se disponível)
        if 'active_locks' in response:
            subheader("Locks Ativos")
            active_locks = response['active_locks']
            if active_locks:
                for lock in active_locks:
                    click.echo(f"  • {click.style(lock, fg='yellow')}")
            else:
                info("  Nenhum lock ativo")
    except click.ClickException:
        sys.exit(1)


@challenges.command("list-challenges")
@click.option(
    "--difficulty",
    help="Filtrar por dificuldade (ex: easy, medium, hard)"
)
@click.option(
    "--category",
    help="Filtrar por categoria (ex: selection, logic)"
)
@click.option(
    "--limit",
    default=100,
    help="Número máximo de resultados"
)
@click.pass_context
def list_challenges(ctx, difficulty, category, limit):
    """
    Listar todos os desafios com filtros opcionais.
    
    \b
    Exemplos:
        # Listar todos os desafios
        python cli.py challenges list-challenges
        
        # Filtrar por dificuldade
        python cli.py challenges list-challenges --difficulty medium
        
        # Filtrar por categoria
        python cli.py challenges list-challenges --category selection
        
        # Limitar resultados
        python cli.py challenges list-challenges --limit 50
    """
    client = ctx.obj["http_client"]

    header("Listar Desafios")

    params = {"limit": limit}
    if difficulty:
        params["difficulty"] = difficulty
    if category:
        params["category"] = category
    
    info("Buscando desafios...")
    
    try:
        response = client.get("/admin/challenges", params=params)
        challenges = response if isinstance(response, list) else response.get('challenges', [])
        
        if not challenges:
            warning("Nenhum desafio encontrado.")
            return
        
        success(f"Encontrados {len(challenges)} desafios")
        
        subheader("Desafios")
        click.echo()

        click.echo(
            f"{click.style('ID', fg='cyan', bold=True):15} "
            f"{click.style('Pergunta', fg='cyan', bold=True):50} "
            f"{click.style('Dificuldade', fg='cyan', bold=True):15} "
            f"{click.style('Categoria', fg='cyan', bold=True):15}"
        )
        click.echo("-" * 95)

        for challenge in challenges:
            challenge_id = challenge.get('id', 'N/A')[:15]
            question = challenge.get('question', 'N/A')[:47] + "..." if len(challenge.get('question', '')) > 50 else challenge.get('question', 'N/A')
            difficulty_val = challenge.get('difficulty', 'N/A')
            category_val = challenge.get('category', 'N/A')
            
            click.echo(
                f"{challenge_id:15} "
                f"{question:50} "
                f"{difficulty_val:15} "
                f"{category_val:15}"
            )
    except click.ClickException:
        sys.exit(1)


@challenges.command("view-challenge")
@click.option(
    "--id",
    "challenge_id",
    required=True,
    help="ID do desafio a visualizar"
)
@click.pass_context
def view_challenge(ctx, challenge_id):
    """
    Ver detalhes completos de um desafio (incluindo resposta).
    
    \b
    Exemplos:
        python cli.py challenges view-challenge --id sel-101
    """
    client = ctx.obj["http_client"]
    
    header(f"Detalhes do Desafio: {challenge_id}")
    
    info(f"Buscando desafio {challenge_id}...")
    
    try:
        response = client.get(f"/admin/challenges/{challenge_id}")
        
        success("Desafio encontrado!")
        
        subheader("Informações do Desafio")
        key_value("ID", response.get('id', 'N/A'), "cyan")
        key_value("Pergunta", response.get('question', 'N/A'), "white")
        key_value("Resposta", response.get('answer', 'N/A'), "green")
        key_value("Dificuldade", response.get('difficulty', 'N/A'), "yellow")
        key_value("Categoria", response.get('category', 'N/A'), "yellow")
        key_value("Pontos", response.get('points', 'N/A'), "green")
        
        if 'hints' in response:
            subheader("Dicas")
            for idx, hint in enumerate(response['hints'], 1):
                click.echo(f"  {idx}. {hint}")
    except click.ClickException:
        sys.exit(1)


@challenges.command("edit-challenge")
@click.option(
    "--id",
    "challenge_id",
    required=True,
    help="ID do desafio a editar"
)
@click.option(
    "--field",
    help="Campo a editar (ex: question, answer, difficulty)"
)
@click.option(
    "--value",
    help="Novo valor para o campo"
)
@click.option(
    "--interactive",
    is_flag=True,
    help="Modo interativo (editar múltiplos campos)"
)
@click.pass_context
def edit_challenge(ctx, challenge_id, field, value, interactive):
    """
    Editar um desafio existente.
    
    \b
    Exemplos:
        # Editar um campo específico
        python cli.py challenges edit-challenge --id sel-101 --field difficulty --value hard
        
        # Modo interativo
        python cli.py challenges edit-challenge --id sel-101 --interactive
    """
    client = ctx.obj["http_client"]
    
    header(f"Editar Desafio: {challenge_id}")
    
    if interactive:
        info(f"Buscando desafio {challenge_id}...")
        
        try:
            current = client.get(f"/admin/challenges/{challenge_id}")
            
            subheader("Valores Atuais")
            key_value("Pergunta", current.get('question', 'N/A'), "white")
            key_value("Resposta", current.get('answer', 'N/A'), "white")
            key_value("Dificuldade", current.get('difficulty', 'N/A'), "white")
            key_value("Categoria", current.get('category', 'N/A'), "white")
            
            click.echo()
            warning("Modo interativo será implementado em versão futura.")
            warning("Use --field e --value para editar campos específicos.")
        except click.ClickException:
            sys.exit(1)
    else:
        if not field or not value:
            error("Modo direto requer --field e --value")
            click.echo("Use --interactive para modo interativo")
            sys.exit(1)
        
        info(f"Atualizando {field} para '{value}'...")
        
        try:
            updates = {field: value}
            response = client.put(f"/admin/challenges/{challenge_id}", data=updates)
            
            success(f"Desafio {challenge_id} atualizado com sucesso!")
            
            subheader("Desafio Atualizado")
            for key, val in response.items():
                key_value(key, val, "white")
        except click.ClickException:
            sys.exit(1)


@challenges.command("upload-challenges")
@click.option(
    "--file",
    "file_path",
    required=True,
    type=click.Path(exists=True),
    help="Caminho para o arquivo CSV com os desafios"
)
@click.option(
    "--preview",
    is_flag=True,
    help="Visualizar desafios antes de fazer upload (sem confirmar)"
)
@click.option(
    "--confirm",
    is_flag=True,
    help="Confirmar upload sem prompt interativo (para automação)"
)
@click.option(
    "--yes",
    "-y",
    is_flag=True,
    help="Confirmar upload sem prompt interativo (alternativa para --confirm)"
)
@click.pass_context
def upload_challenges(ctx, file_path, preview, confirm, yes):
    """
    Fazer upload em massa de desafios via arquivo CSV.
    
    Esta é uma operação DESTRUTIVA que:
    - Faz upload de múltiplos desafios para o Firebase
    - Pode sobrescrever desafios existentes
    - Requer validação do formato CSV
    
    \b
    Formato CSV esperado:
        - Codificação: UTF-8
        - Separador: ; (ponto e vírgula)
        - Campos obrigatórios: id, question, answer, level, sector, points
    
    \b
    Exemplos:
        # Visualizar desafios antes de fazer upload
        python cli.py challenges upload-challenges --file desafios.csv --preview
        
        # Upload com confirmação interativa
        python cli.py challenges upload-challenges --file desafios.csv
        
        # Upload sem confirmação (para automação)
        python cli.py challenges upload-challenges --file desafios.csv --confirm
        python cli.py challenges upload-challenges --file desafios.csv -y
    """
    client = ctx.obj["http_client"]

    header("Upload de Desafios")

    if preview:
        info("Modo preview - desafios não serão enviados")
        warning("Funcionalidade de preview ainda não implementada")
        return

    if not confirm_destructive_operation(
        operation="Upload de Desafios",
        details=f"Desafios do arquivo '{file_path}' serão enviados para o Firebase",
        confirm_flag=confirm,
        yes_flag=yes
    ):
        warning("Operação cancelada pelo usuário.")
        return

    info(f"Fazendo upload de desafios do arquivo {file_path}...")

    try:
        warning("Funcionalidade de upload ainda não implementada")
    except click.ClickException:
        sys.exit(1)


@system.command("close-season")
@click.option(
    "--confirm",
    is_flag=True,
    help="Pular prompt de confirmação (para automação)"
)
@click.option(
    "--yes",
    "-y",
    is_flag=True,
    help="Pular prompt de confirmação (alternativa para --confirm)"
)
@click.pass_context
def close_season(ctx, confirm, yes):
    """
    Fechar a temporada atual.
    
    Esta é uma operação DESTRUTIVA que:
    - Transiciona temporada de ACTIVE → LOCKING → CLOSED
    - Bloqueia novas submissões
    - Cria snapshot final do ranking
    - Não pode ser desfeita
    
    \b
    Exemplos:
        # Confirmação interativa
        python cli.py system close-season
        
        # Pular confirmação para automação
        python cli.py system close-season --confirm
        python cli.py system close-season --yes
        python cli.py system close-season -y
    """
    client = ctx.obj["http_client"]
    
    header("Fechar Temporada")
    
    # Confirmar operação destrutiva
    if not confirm_destructive_operation(
        operation="Fechar Temporada",
        details="A temporada atual será fechada e não poderá ser reaberta",
        confirm_flag=confirm,
        yes_flag=yes
    ):
        warning("Operação cancelada pelo usuário.")
        return

    info("Fechando temporada...")

    try:
        response = client.post("/internal/cron/close-season")
        success("Temporada fechada com sucesso!")
        
        if response:
            subheader("Detalhes")
            for key, value in response.items():
                key_value(key, value, "white")
    except click.ClickException:
        sys.exit(1)


@challenges.command("delete-challenge")
@click.option(
    "--id",
    "challenge_id",
    required=True,
    help="ID do desafio a deletar"
)
@click.option(
    "--confirm",
    is_flag=True,
    help="Pular prompt de confirmação (para automação)"
)
@click.option(
    "--yes",
    "-y",
    is_flag=True,
    help="Pular prompt de confirmação (alternativa para --confirm)"
)
@click.pass_context
def delete_challenge(ctx, challenge_id, confirm, yes):
    """
    Deletar um desafio permanentemente.
    
    Esta é uma operação DESTRUTIVA que:
    - Deleta permanentemente o desafio do Firebase
    - Cria um backup antes da deleção
    - Não pode ser desfeita
    
    \b
    Exemplos:
        # Confirmação interativa
        python cli.py challenges delete-challenge --id ch_001
        
        # Pular confirmação para automação
        python cli.py challenges delete-challenge --id ch_001 --confirm
        python cli.py challenges delete-challenge --id ch_001 -y
    """
    client = ctx.obj["http_client"]
    
    header("Deletar Desafio")
    
    # Confirmar operação destrutiva
    if not confirm_destructive_operation(
        operation="Deletar Desafio",
        details=f"Desafio {challenge_id} será permanentemente deletado (backup será criado)",
        confirm_flag=confirm,
        yes_flag=yes
    ):
        warning("Operação cancelada pelo usuário.")
        return

    info(f"Deletando desafio {challenge_id}...")

    try:
        response = client.delete(f"/admin/challenges/{challenge_id}")
        success(f"Desafio {challenge_id} deletado com sucesso!")
        
        if response:
            subheader("Detalhes")
            for key, value in response.items():
                key_value(key, value, "white")
    except click.ClickException:
        sys.exit(1)


@users.command("list-users")
@click.option(
    "--banned",
    type=click.Choice(['true', 'false'], case_sensitive=False),
    help="Filtrar por status de ban (true/false)"
)
@click.option(
    "--min-level",
    type=int,
    help="Nível mínimo"
)
@click.option(
    "--min-xp",
    type=int,
    help="XP mínimo"
)
@click.option(
    "--limit",
    default=100,
    help="Número máximo de resultados"
)
@click.option(
    "--offset",
    default=0,
    help="Offset para paginação"
)
@click.pass_context
def list_users(ctx, banned, min_level, min_xp, limit, offset):
    """
    Listar usuários com filtros opcionais.
    
    \b
    Exemplos:
        # Listar todos os usuários
        python cli.py users list-users
        
        # Listar apenas usuários banidos
        python cli.py users list-users --banned true
        
        # Filtrar por nível mínimo
        python cli.py users list-users --min-level 5
        
        # Filtrar por XP mínimo
        python cli.py users list-users --min-xp 1000
        
        # Paginação
        python cli.py users list-users --limit 50 --offset 100
    """
    client = ctx.obj["http_client"]

    header("Listar Usuários")

    params = {"limit": limit, "offset": offset}
    if banned:
        params["banned"] = banned.lower() == 'true'
    if min_level:
        params["min_level"] = min_level
    if min_xp:
        params["min_xp"] = min_xp
    
    info("Buscando usuários...")
    
    try:
        response = client.get("/admin/users", params=params)
        users = response.get('users', [])
        total = response.get('total', 0)
        
        if not users:
            warning("Nenhum usuário encontrado.")
            return
        
        success(f"Encontrados {len(users)} usuários (total: {total})")
        
        subheader("Usuários")
        click.echo()

        click.echo(
            f"{click.style('ID', fg='cyan', bold=True):38} "
            f"{click.style('Nickname', fg='cyan', bold=True):20} "
            f"{click.style('XP', fg='cyan', bold=True):8} "
            f"{click.style('Nível', fg='cyan', bold=True):6} "
            f"{click.style('Banido', fg='cyan', bold=True):8}"
        )
        click.echo("-" * 80)

        for user in users:
            user_id = user.get('id', 'N/A')[:36]
            nickname = user.get('nickname', 'N/A')[:18]
            xp = str(user.get('xp', 0))
            level = str(user.get('level', 0))
            banned_status = "Sim" if user.get('banned', False) else "Não"
            banned_color = "red" if user.get('banned', False) else "green"
            
            click.echo(
                f"{user_id:38} "
                f"{nickname:20} "
                f"{xp:8} "
                f"{level:6} "
                f"{click.style(banned_status, fg=banned_color):8}"
            )
        
        if total > limit:
            click.echo()
            info(f"Mostrando {offset + 1}-{offset + len(users)} de {total} usuários")
    except click.ClickException:
        sys.exit(1)


@users.command("view-user")
@click.option(
    "--id",
    "user_id",
    required=True,
    help="ID do usuário a visualizar"
)
@click.pass_context
def view_user(ctx, user_id):
    """
    Ver detalhes completos de um usuário.
    
    \b
    Exemplos:
        python cli.py users view-user --id abc123-def456-ghi789
    """
    client = ctx.obj["http_client"]
    
    header(f"Detalhes do Usuário: {user_id}")
    
    info(f"Buscando usuário {user_id}...")
    
    try:
        response = client.get(f"/admin/users/{user_id}")
        
        success("Usuário encontrado!")
        
        subheader("Informações do Usuário")
        key_value("ID", response.get('id', 'N/A'), "cyan")
        key_value("Nickname", response.get('nickname', 'N/A'), "white")
        key_value("XP", response.get('xp', 0), "green")
        key_value("Nível", response.get('level', 0), "green")
        key_value("Desafios Completados", response.get('challenges_completed', 0), "yellow")
        key_value("Minigames Completados", response.get('minigames_completed', 0), "yellow")

        banned = response.get('banned', False)
        banned_color = "red" if banned else "green"
        banned_text = "Sim" if banned else "Não"
        key_value("Banido", banned_text, banned_color)
        
        if banned:
            key_value("  Banido em", response.get('banned_at', 'N/A'), "red")
            key_value("  Motivo", response.get('ban_reason', 'N/A'), "red")

        key_value("Criado em", response.get('created_at', 'N/A'), "white")
        key_value("Atualizado em", response.get('updated_at', 'N/A'), "white")
    except click.ClickException:
        sys.exit(1)


@users.command("unban-user")
@click.option(
    "--id",
    "user_id",
    required=True,
    help="ID do usuário a desbanir"
)
@click.pass_context
def unban_user(ctx, user_id):
    """
    Desbanir um usuário da plataforma.
    
    Esta operação:
    - Remove o status de banido do usuário
    - Permite que o usuário faça login novamente
    - Registra a operação nos logs de auditoria
    
    \b
    Exemplos:
        python cli.py users unban-user --id abc123
    """
    client = ctx.obj["http_client"]
    
    header("Desbanir Usuário")
    
    info(f"Desbanindo usuário {user_id}...")
    
    try:
        response = client.post(f"/admin/users/{user_id}/unban")
        success(f"Usuário {user_id} desbanido com sucesso!")
        
        if response:
            subheader("Detalhes")
            for key, value in response.items():
                key_value(key, value, "white")
    except click.ClickException:
        sys.exit(1)


@users.command("ban-user")
@click.option(
    "--id",
    "user_id",
    required=True,
    help="ID do usuário a banir"
)
@click.option(
    "--reason",
    required=True,
    help="Motivo para banir o usuário"
)
@click.option(
    "--confirm",
    is_flag=True,
    help="Pular prompt de confirmação (para automação)"
)
@click.option(
    "--yes",
    "-y",
    is_flag=True,
    help="Pular prompt de confirmação (alternativa para --confirm)"
)
@click.pass_context
def ban_user(ctx, user_id, reason, confirm, yes):
    """
    Banir um usuário da plataforma.
    
    Esta é uma operação DESTRUTIVA que:
    - Marca o usuário como banido no banco de dados
    - Impede o usuário de fazer login
    - Registra a operação nos logs de auditoria
    
    \b
    Exemplos:
        # Confirmação interativa
        python cli.py users ban-user --id abc123 --reason "Trapaça detectada"
        
        # Pular confirmação para automação
        python cli.py users ban-user --id abc123 --reason "Violação" --confirm
        python cli.py users ban-user --id abc123 --reason "Violação" -y
    """
    client = ctx.obj["http_client"]
    
    header("Banir Usuário")
    
    # Confirmar operação destrutiva
    if not confirm_destructive_operation(
        operation="Banir Usuário",
        details=f"Usuário {user_id} será banido. Motivo: {reason}",
        confirm_flag=confirm,
        yes_flag=yes
    ):
        warning("Operação cancelada pelo usuário.")
        return

    info(f"Banindo usuário {user_id}...")

    try:
        response = client.post(f"/admin/users/{user_id}/ban", data={"reason": reason})
        success(f"Usuário {user_id} banido com sucesso!")
        
        if response:
            subheader("Detalhes")
            for key, value in response.items():
                key_value(key, value, "white")
    except click.ClickException:
        sys.exit(1)


@users.command("reset-progress")
@click.option(
    "--id",
    "user_id",
    required=True,
    help="ID do usuário para resetar progresso"
)
@click.option(
    "--confirm",
    is_flag=True,
    help="Pular prompt de confirmação (para automação)"
)
@click.option(
    "--yes",
    "-y",
    is_flag=True,
    help="Pular prompt de confirmação (alternativa para --confirm)"
)
@click.pass_context
def reset_progress(ctx, user_id, confirm, yes):
    """
    Resetar todo o progresso de um usuário.
    
    Esta é uma operação DESTRUTIVA que:
    - Reseta o XP do usuário para 0
    - Limpa todas as tentativas de desafios
    - Não pode ser desfeita
    
    \b
    Exemplos:
        # Confirmação interativa
        python cli.py users reset-progress --id abc123
        
        # Pular confirmação para automação
        python cli.py users reset-progress --id abc123 --confirm
        python cli.py users reset-progress --id abc123 -y
    """
    client = ctx.obj["http_client"]
    
    header("Resetar Progresso do Usuário")
    
    # Confirmar operação destrutiva
    if not confirm_destructive_operation(
        operation="Resetar Progresso do Usuário",
        details=f"Todo o progresso do usuário {user_id} será permanentemente deletado",
        confirm_flag=confirm,
        yes_flag=yes
    ):
        warning("Operação cancelada pelo usuário.")
        return

    info(f"Resetando progresso do usuário {user_id}...")

    try:
        response = client.post(f"/admin/users/{user_id}/reset-progress")
        success(f"Progresso resetado com sucesso para o usuário {user_id}!")
        
        if response:
            subheader("Detalhes")
            for key, value in response.items():
                key_value(key, value, "white")
    except click.ClickException:
        sys.exit(1)


@system.command("clear-lock")
@click.option(
    "--job-name",
    required=True,
    help="Nome do lock do job a limpar (ex: 'generate-daily-ranking')"
)
@click.option(
    "--confirm",
    is_flag=True,
    help="Pular prompt de confirmação (para automação)"
)
@click.option(
    "--yes",
    "-y",
    is_flag=True,
    help="Pular prompt de confirmação (alternativa para --confirm)"
)
@click.pass_context
def clear_lock(ctx, job_name, confirm, yes):
    """
    Limpar um lock distribuído travado.
    
    Esta é uma operação DESTRUTIVA que:
    - Remove o lock distribuído do banco de dados
    - Pode afetar jobs de cron em execução
    - Deve ser usada apenas quando um job está travado
    
    \b
    Exemplos:
        # Confirmação interativa
        python cli.py system clear-lock --job-name generate-daily-ranking
        
        # Pular confirmação para automação
        python cli.py system clear-lock --job-name ranking --confirm
        python cli.py system clear-lock --job-name ranking -y
    """
    client = ctx.obj["http_client"]
    
    header("Limpar Lock Distribuído")
    
    # Confirmar operação destrutiva
    if not confirm_destructive_operation(
        operation="Limpar Lock Distribuído",
        details=f"Lock '{job_name}' será removido. Isso pode afetar jobs em execução.",
        confirm_flag=confirm,
        yes_flag=yes
    ):
        warning("Operação cancelada pelo usuário.")
        return

    info(f"Limpando lock '{job_name}'...")

    try:
        response = client.delete(f"/admin/locks/{job_name}")
        success(f"Lock '{job_name}' limpo com sucesso!")
        
        if response:
            subheader("Detalhes")
            for key, value in response.items():
                key_value(key, value, "white")
    except click.ClickException:
        sys.exit(1)


if __name__ == "__main__":
    cli()
