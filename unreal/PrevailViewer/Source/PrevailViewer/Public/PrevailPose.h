#pragma once

#include "CoreMinimal.h"

/** Dead-reckoned follow of GPS so the car coasts instead of teleporting. */
struct FPrevailPoseTracker
{
	void SetTarget(const FVector& GpsCm, float YawDeg, double SpeedMps)
	{
		const float SpeedCm = static_cast<float>(SpeedMps * 100.0);
		if (!bReady)
		{
			Drawn = GpsCm;
			Goal = GpsCm;
			DrawnYaw = YawDeg;
			GoalYaw = YawDeg;
			SpeedCmS = SpeedCm;
			ApplyVelocity(SpeedCm, YawDeg);
			LastGoalAt = FPlatformTime::Seconds();
			bReady = true;
			return;
		}

		const FVector Delta = GpsCm - Goal;
		const float Moved = Delta.Size();
		if (Moved < 8.0f)
		{
			SpeedCmS = SpeedCm;
			ApplyVelocity(SpeedCm, GoalYaw);
			return;
		}

		const FVector FromDrawn = GpsCm - Drawn;
		if (SpeedCmS > 40.0f && Along(FromDrawn) < -40.0f)
		{
			return;
		}

		const double Now = FPlatformTime::Seconds();
		const float Dt = FMath::Max(static_cast<float>(Now - LastGoalAt), 0.001f);
		const float GpsYaw = FMath::RadiansToDegrees(FMath::Atan2(Delta.Y, Delta.X));
		GoalYaw = (Moved / Dt) > 40.0f ? GpsYaw : YawDeg;
		Goal = GpsCm;
		SpeedCmS = SpeedCm > 30.0f ? SpeedCm : Moved / Dt;
		ApplyVelocity(SpeedCmS, GoalYaw);
		LastGoalAt = Now;
	}

	void Sample(float DeltaSeconds, FVector& OutLocation, float& OutYaw)
	{
		if (!bReady)
		{
			OutLocation = Drawn;
			OutYaw = DrawnYaw;
			return;
		}

		const float Dt = FMath::Min(DeltaSeconds, 0.05f);
		const float Age = FMath::Min(static_cast<float>(FPlatformTime::Seconds() - LastGoalAt), 0.7f);
		const FVector Predicted = Goal + Velocity * Age;
		const float K = 1.0f - FMath::Exp(-Dt / 0.11f);
		Drawn = FMath::Lerp(Drawn, Predicted, K);
		DrawnYaw = FMath::UnwindDegrees(DrawnYaw + FMath::FindDeltaAngleDegrees(DrawnYaw, GoalYaw) * K);
		OutLocation = Drawn;
		OutYaw = DrawnYaw;
	}

	bool IsReady() const { return bReady; }

	FVector Drawn = FVector::ZeroVector;
	float SpeedCmS = 0.0f;

private:
	void ApplyVelocity(float SpeedCm, float YawDeg)
	{
		const FRotator Rot(0.0f, YawDeg, 0.0f);
		Velocity = Rot.Vector() * SpeedCm;
	}

	float Along(const FVector& Offset) const
	{
		const float Travel = Velocity.Size2D();
		if (Travel < 20.0f)
		{
			return FVector::DotProduct(Offset, FRotator(0.0f, GoalYaw, 0.0f).Vector());
		}
		return FVector::DotProduct(Offset, Velocity) / Travel;
	}

	FVector Goal = FVector::ZeroVector;
	FVector Velocity = FVector::ZeroVector;
	float GoalYaw = 0.0f;
	float DrawnYaw = 0.0f;
	double LastGoalAt = 0.0;
	bool bReady = false;
};
