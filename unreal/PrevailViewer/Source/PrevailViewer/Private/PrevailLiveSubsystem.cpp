#include "PrevailLiveSubsystem.h"
#include "HttpModule.h"
#include "Interfaces/IHttpResponse.h"
#include "Containers/Ticker.h"

void UPrevailLiveSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	TickHandle = FTSTicker::GetCoreTicker().AddTicker(
		FTickerDelegate::CreateUObject(this, &UPrevailLiveSubsystem::TickPoll),
		0.0f);
}

void UPrevailLiveSubsystem::Deinitialize()
{
	FTSTicker::GetCoreTicker().RemoveTicker(TickHandle);
	Super::Deinitialize();
}

bool UPrevailLiveSubsystem::TickPoll(float DeltaTime)
{
	Accrued += DeltaTime;
	if (Accrued >= PollSeconds)
	{
		Accrued = 0.0f;
		Poll();
	}
	return true;
}

void UPrevailLiveSubsystem::Poll()
{
	if (bRequestInFlight)
	{
		return;
	}

	bRequestInFlight = true;
	const TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	FString Url = BackendUrl;
	Url.RemoveFromEnd(TEXT("/"));
	Request->SetURL(Url + TEXT("/v1/snapshot"));
	Request->SetVerb(TEXT("GET"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
	Request->OnProcessRequestComplete().BindUObject(this, &UPrevailLiveSubsystem::OnResponse);
	if (!Request->ProcessRequest())
	{
		bRequestInFlight = false;
		bConnected = false;
	}
}

void UPrevailLiveSubsystem::OnResponse(FHttpRequestPtr Request, FHttpResponsePtr Response, bool bSucceeded)
{
	bRequestInFlight = false;
	if (!bSucceeded || !Response.IsValid() || Response->GetResponseCode() != 200)
	{
		bConnected = false;
		return;
	}

	FPrevailSnapshot Parsed;
	if (!ParsePrevailSnapshot(Response->GetContentAsString(), Parsed))
	{
		bConnected = false;
		return;
	}

	bConnected = true;
	Latest = Parsed;
	OnSnapshot.Broadcast(Latest);
}
