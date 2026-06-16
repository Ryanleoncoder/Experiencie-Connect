from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class UserData(BaseModel):
    id: str
    nickname: str
    xp: int
    level: int


class AuthResponse(BaseModel):
    token: str
    user: UserData


class ValidateAnswerResponse(BaseModel):
    correct: bool
    attempt_number: int
    attempts_remaining: int
    xp_gained: int
    message: str


class ProgressResponse(BaseModel):
    user: Dict[str, Any]
    challenges: Dict[str, Any]
    minigames: Dict[str, Any]
    attempts: Dict[str, Any]


class ErrorResponse(BaseModel):
    error: str
    message: str
    detail: Optional[str] = None
    retry_after: Optional[int] = None
    attempts_left: Optional[int] = None


class BanUserResponse(BaseModel):
    success: bool
    user_id: str
    banned: bool


class UserDetailsResponse(BaseModel):
    id: str
    nickname: str
    xp: int
    level: int
    challenges_completed: int
    minigames_completed: int
    banned: bool
    banned_at: Optional[str] = None
    ban_reason: Optional[str] = None
    created_at: str
    updated_at: str


class UserSummary(BaseModel):
    id: str
    nickname: str
    xp: int
    level: int
    challenges_completed: int
    minigames_completed: int
    banned: bool
    created_at: str


class ListUsersResponse(BaseModel):
    users: List[UserSummary]
    total: int
    limit: int
    offset: int


class SeasonResponse(BaseModel):
    id: str
    name: str
    state: str
    start_date: str
    end_date: Optional[str] = None


class ChallengeResponse(BaseModel):
    id: str
    question: str
    answer: str
    difficulty: str
    category: str
    points: int
    created_at: str
    updated_at: str


class UploadChallengesResponse(BaseModel):
    success: bool
    uploaded: int
    errors: List[str]

