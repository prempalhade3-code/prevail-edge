#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "PrevailSnapshot.h"
#include "PrevailGameMode.generated.h"

class APrevailTrafficActor;

UCLASS()
class PREVAILVIEWER_API APrevailGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	APrevailGameMode();
	virtual void BeginPlay() override;

private:
	void SpawnGround();

	UFUNCTION()
	void SyncTraffic(const FPrevailSnapshot& Snapshot);

	UPROPERTY()
	TMap<FString, TObjectPtr<APrevailTrafficActor>> Traffic;
};
