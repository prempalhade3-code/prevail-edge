#pragma once

#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Interfaces/IHttpRequest.h"
#include "PrevailSnapshot.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "PrevailLiveSubsystem.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnPrevailSnapshot, const FPrevailSnapshot&, Snapshot);

/**
 * Polls the existing FastAPI aggregator. The Rust edges, predictor, and
 * road simulator keep running exactly as they do for the browser HUD.
 */
UCLASS()
class PREVAILVIEWER_API UPrevailLiveSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UPROPERTY(BlueprintAssignable, Category = "PREVAIL")
	FOnPrevailSnapshot OnSnapshot;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	FPrevailSnapshot Latest;

	UPROPERTY(BlueprintReadOnly, Category = "PREVAIL")
	bool bConnected = false;

	UPROPERTY(EditAnywhere, Category = "PREVAIL")
	FString BackendUrl = TEXT("http://127.0.0.1:8000");

	UPROPERTY(EditAnywhere, Category = "PREVAIL")
	float PollSeconds = 0.10f;

private:
	bool TickPoll(float DeltaTime);
	void Poll();
	void OnResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded);

	FTSTicker::FDelegateHandle TickHandle;
	float Accrued = 0.0f;
	bool bRequestInFlight = false;
};
