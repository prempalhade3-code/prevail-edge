#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "PrevailPose.h"
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
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Body;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Cabin;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Nose;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> WheelFL;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> WheelFR;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> WheelRL;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> WheelRR;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USpringArmComponent> SpringArm;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;

	FVector DrawnLocation() const { return Tracker.Drawn; }
	void SnapToCorridorStart();

private:
	void ApplyPaint();
	void FollowSnapshot(float DeltaSeconds);
	void SpinWheels(float DeltaSeconds);
	UStaticMeshComponent* MakePart(const FName& Name, UStaticMesh* Mesh, const FVector& Location, const FVector& Scale);

	FPrevailPoseTracker Tracker;
	float WheelSpin = 0.0f;
};
