from pydantic import BaseModel, Field
from typing import Optional


class LoginRequest(BaseModel):
    nickname: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)


class RegisterRequest(BaseModel):
    nickname: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    invite_code: str = Field(..., min_length=1)


class ValidateAnswerRequest(BaseModel):
    challenge_id: str = Field(..., min_length=1, alias='challengeId')
    answer: str = Field(..., min_length=1)
    level: int = Field(..., gt=0)
    setor: str = Field(..., min_length=1)
    season_id: str = Field(..., min_length=1, alias='seasonId')
    time_ms: Optional[int] = Field(None, alias='timeMs')

    class Config:
        populate_by_name = True


class RefreshTokenRequest(BaseModel):
    token: str = Field(..., min_length=1)


class BanUserRequest(BaseModel):
    reason: str = Field(..., min_length=1)
    banned_by: Optional[str] = None


class CreateSeasonRequest(BaseModel):
    name: str = Field(..., min_length=1)
    start_date: str = Field(..., min_length=1)
    end_date: Optional[str] = None


class UpdateSeasonStateRequest(BaseModel):
    new_state: str = Field(..., pattern="^(ACTIVE|LOCKING|CLOSED|ARCHIVED)$")


class UploadChallengesRequest(BaseModel):
    csv_data: str = Field(..., min_length=1)


class UpdateChallengeRequest(BaseModel):
    question: Optional[str] = None
    answer: Optional[str] = None
    difficulty: Optional[str] = None
    category: Optional[str] = None
    points: Optional[int] = None

