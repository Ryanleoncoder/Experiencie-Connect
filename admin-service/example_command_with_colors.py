#!/usr/bin/env python3
"""
Example command implementation showing how to use colored output utilities.
This serves as a template for implementing future CLI commands (Tasks 20-22).
"""

import click
from cli import (
    success, error, warning, info,
    header, subheader, key_value,
    progress_bar, spinner
)


def example_upload_challenges_command(file_path: str, confirm: bool = False):
    """
    Example implementation of upload-challenges command.
    Demonstrates proper use of colored output and progress indicators.
    """
    
    # Display header
    header("Upload Challenges")
    
    info(f"Reading file: {file_path}")
    
    # Simulate reading CSV
    try:
        # In real implementation, this would read the CSV file
        challenges = [
            {"id": "ch_001", "question": "Question 1", "answer": "Answer 1"},
            {"id": "ch_002", "question": "Question 2", "answer": "Answer 2"},
            {"id": "ch_003", "question": "Question 3", "answer": "Answer 3"},
            {"id": "ch_004", "question": "Question 4", "answer": "Answer 4"},
            {"id": "ch_005", "question": "Question 5", "answer": "Answer 5"},
        ]
    except FileNotFoundError:
        error(f"File not found: {file_path}")
        return
    except Exception as e:
        error(f"Failed to read file: {str(e)}")
        return
    
    # Display summary
    subheader("Upload Summary")
    key_value("Total challenges", len(challenges), "cyan")
    key_value("File", file_path, "white")
    
    if not confirm:
        warning("Preview mode - use --confirm to actually upload")
        
        info("Preview of challenges:")
        for i, challenge in enumerate(challenges[:3], 1):
            click.echo(f"  {i}. {challenge['id']}: {challenge['question']}")
        
        if len(challenges) > 3:
            click.echo(f"  ... and {len(challenges) - 3} more")
        
        return
    
    # Perform upload with progress bar
    info("Starting upload...")
    
    uploaded = 0
    failed = 0
    
    with progress_bar(challenges, label="Uploading challenges") as bar:
        for challenge in bar:
            try:
                # In real implementation, this would call the API
                # client.post("/admin/challenges", data=challenge)
                uploaded += 1
            except Exception as e:
                error(f"Failed to upload {challenge['id']}: {str(e)}")
                failed += 1
    
    # Display results
    click.echo()  # Empty line for spacing
    subheader("Upload Results")
    
    if failed == 0:
        success(f"Successfully uploaded all {uploaded} challenges!")
        key_value("Uploaded", uploaded, "green")
    else:
        warning(f"Upload completed with {failed} failures")
        key_value("Uploaded", uploaded, "green")
        key_value("Failed", failed, "red")


def example_generate_ranking_command():
    """
    Example implementation of generate-ranking command.
    Demonstrates use of spinner for operations without known progress.
    """
    
    header("Generate Daily Ranking")
    
    info("Connecting to backend API...")
    
    try:
        # Simulate API call with spinner
        def generate():
            # In real implementation, this would call the API
            import time
            time.sleep(2)  # Simulate work
            return {
                "status": "success",
                "ranking_file": "ranking-2024-03-15.json",
                "players_count": 487,
                "duration_ms": 1234,
                "storage_url": "https://supabase.co/storage/..."
            }
        
        info("Generating ranking...")
        response = spinner(generate, "Processing...")
        
        # Display success
        success("Ranking generated successfully!")
        
        # Display details
        subheader("Ranking Details")
        key_value("File", response["ranking_file"], "cyan")
        key_value("Players", response["players_count"], "white")
        key_value("Duration", f"{response['duration_ms']}ms", "white")
        key_value("URL", response["storage_url"], "cyan")
        
    except Exception as e:
        error(f"Failed to generate ranking: {str(e)}")
        return


def example_view_status_command():
    """
    Example implementation of view-status command.
    Demonstrates structured output with headers and key-value pairs.
    """
    
    header("System Status")
    
    # Backend status
    subheader("Backend Services")
    key_value("API URL", "http://localhost:8000", "cyan")
    key_value("Status", "Healthy", "green")
    key_value("Uptime", "3 days, 5 hours", "white")
    key_value("Version", "1.0.0", "white")
    
    # Database status
    subheader("Database Connections")
    key_value("Supabase", "Connected", "green")
    key_value("Firebase", "Connected", "green")
    key_value("Redis", "Disconnected", "yellow")
    
    warning("Redis is optional and not required for operation")
    
    # Cron jobs status
    subheader("Cron Jobs")
    key_value("Last ranking generation", "2024-03-15 19:05:00", "white")
    key_value("Last cleanup", "2024-03-15 03:00:00", "white")
    key_value("Active locks", "0", "green")
    
    # Overall status
    click.echo()  # Empty line
    success("All critical services are operational")


if __name__ == "__main__":
    # Run examples
    print("\n" + "="*60)
    print("Example 1: Upload Challenges (Preview Mode)")
    print("="*60)
    example_upload_challenges_command("challenges.csv", confirm=False)
    
    print("\n" + "="*60)
    print("Example 2: Upload Challenges (Confirm Mode)")
    print("="*60)
    example_upload_challenges_command("challenges.csv", confirm=True)
    
    print("\n" + "="*60)
    print("Example 3: Generate Ranking")
    print("="*60)
    example_generate_ranking_command()
    
    print("\n" + "="*60)
    print("Example 4: View Status")
    print("="*60)
    example_view_status_command()
