#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "PrevailSnapshot.h"
#include "PrevailGameMode.generated.h"

class APrevailCity;
class APrevailTrafficActor;

UCLASS()
class PREVAILVIEWER_API APrevailGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	APrevailGameMode();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void SpawnWorld();

	UFUNCTION()
	void SyncTraffic(const FPrevailSnapshot& Snapshot);

	UPROPERTY()
	TObjectPtr<APrevailCity> City;

	UPROPERTY()
	TMap<FString, TObjectPtr<APrevailTrafficActor>> Traffic;
};
