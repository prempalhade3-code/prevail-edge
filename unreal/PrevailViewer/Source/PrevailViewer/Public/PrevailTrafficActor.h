#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PrevailTrafficActor.generated.h"

UCLASS()
class PREVAILVIEWER_API APrevailTrafficActor : public AActor
{
	GENERATED_BODY()

public:
	APrevailTrafficActor();

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Body;

	void ApplyPose(const FVector& Location, float YawDeg);
};
