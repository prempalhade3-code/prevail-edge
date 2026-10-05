#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PrevailPose.h"
#include "PrevailTrafficActor.generated.h"

UCLASS()
class PREVAILVIEWER_API APrevailTrafficActor : public AActor
{
	GENERATED_BODY()

public:
	APrevailTrafficActor();
	virtual void Tick(float DeltaSeconds) override;

	void SetTarget(const FVector& Location, float YawDeg, double SpeedMps);
	void SetPaint(const FLinearColor& Color);

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Body;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Cabin;

private:
	FPrevailPoseTracker Tracker;
	bool bPainted = false;
};
