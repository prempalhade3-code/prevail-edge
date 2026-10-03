#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "PrevailVehiclePawn.generated.h"

class UCameraComponent;
class USpringArmComponent;
class UStaticMeshComponent;

UCLASS()
class PREVAILVIEWER_API APrevailVehiclePawn : public APawn
{
	GENERATED_BODY()

public:
	APrevailVehiclePawn();
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Body;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USpringArmComponent> SpringArm;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;

private:
	void FollowSnapshot(float DeltaSeconds);

	FVector Goal = FVector::ZeroVector;
	FVector VelocityCm = FVector::ZeroVector;
	float GoalYaw = 0.0f;
	bool bHasGoal = false;
};
