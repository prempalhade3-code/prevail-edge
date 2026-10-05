#include "PrevailGameMode.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "Kismet/GameplayStatics.h"
#include "PrevailCity.h"
#include "PrevailGeo.h"
#include "PrevailHud.h"
#include "PrevailLiveSubsystem.h"
#include "PrevailPlayerController.h"
#include "PrevailTrafficActor.h"
#include "PrevailVehiclePawn.h"

APrevailGameMode::APrevailGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	DefaultPawnClass = APrevailVehiclePawn::StaticClass();
	PlayerControllerClass = APrevailPlayerController::StaticClass();
	HUDClass = APrevailHud::StaticClass();
}

void APrevailGameMode::BeginPlay()
{
	Super::BeginPlay();
	SpawnWorld();

	if (UGameInstance* GI = GetGameInstance())
	{
		if (UPrevailLiveSubsystem* Live = GI->GetSubsystem<UPrevailLiveSubsystem>())
		{
			Live->OnSnapshot.AddDynamic(this, &APrevailGameMode::SyncTraffic);
		}
	}
}

void APrevailGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!City)
	{
		return;
	}
	if (APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		City->SetFocus(Pawn->GetActorLocation());
	}
}

void APrevailGameMode::SpawnWorld()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	TArray<AActor*> Existing;
	UGameplayStatics::GetAllActorsOfClass(World, ADirectionalLight::StaticClass(), Existing);
	for (AActor* Actor : Existing)
	{
		Actor->Destroy();
	}
	Existing.Reset();
	UGameplayStatics::GetAllActorsOfClass(World, ASkyLight::StaticClass(), Existing);
	for (AActor* Actor : Existing)
	{
		Actor->Destroy();
	}
	Existing.Reset();
	UGameplayStatics::GetAllActorsOfClass(World, AExponentialHeightFog::StaticClass(), Existing);
	for (AActor* Actor : Existing)
	{
		Actor->Destroy();
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	City = World->SpawnActor<APrevailCity>(FVector::ZeroVector, FRotator::ZeroRotator, Params);

	if (ADirectionalLight* Sun = World->SpawnActor<ADirectionalLight>(FVector(0.0f, 0.0f, 80000.0f), FRotator(-48.0f, -35.0f, 0.0f), Params))
	{
		if (UDirectionalLightComponent* Light = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			Light->SetMobility(EComponentMobility::Movable);
			Light->SetIntensity(10.0f);
		}
	}
	if (ASkyLight* Sky = World->SpawnActor<ASkyLight>(FVector::ZeroVector, FRotator::ZeroRotator, Params))
	{
		if (USkyLightComponent* Light = Sky->GetLightComponent())
		{
			Light->SetIntensity(1.15f);
			Light->bRealTimeCapture = true;
		}
	}
	if (APrevailVehiclePawn* Car = Cast<APrevailVehiclePawn>(UGameplayStatics::GetPlayerPawn(this, 0)))
	{
		Car->SnapToCorridorStart();
	}
}

void APrevailGameMode::SyncTraffic(const FPrevailSnapshot& Snapshot)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	static const FLinearColor Palette[] = {
		FLinearColor(0.12f, 0.42f, 0.22f),
		FLinearColor(0.15f, 0.18f, 0.22f),
		FLinearColor(0.72f, 0.72f, 0.74f),
		FLinearColor(0.08f, 0.22f, 0.55f),
		FLinearColor(0.55f, 0.42f, 0.12f),
	};

	TSet<FString> Seen;
	int32 Index = 0;
	for (const FPrevailTrafficVehicle& Car : Snapshot.Traffic)
	{
		Seen.Add(Car.VehicleId);
		APrevailTrafficActor* Actor = Traffic.FindRef(Car.VehicleId);
		if (!Actor)
		{
			Actor = World->SpawnActor<APrevailTrafficActor>();
			if (!Actor)
			{
				continue;
			}
			Actor->SetPaint(Palette[Index % UE_ARRAY_COUNT(Palette)]);
			Traffic.Add(Car.VehicleId, Actor);
		}
		Actor->SetTarget(
			PrevailGeo::LatLonToUnreal(Car.Latitude, Car.Longitude, 0.0),
			PrevailGeo::HeadingToYaw(Car.HeadingDeg),
			Car.SpeedMps);
		++Index;
	}

	TArray<FString> Dead;
	for (const auto& Pair : Traffic)
	{
		if (!Seen.Contains(Pair.Key))
		{
			Dead.Add(Pair.Key);
		}
	}
	for (const FString& Id : Dead)
	{
		if (APrevailTrafficActor* Actor = Traffic.FindRef(Id))
		{
			Actor->Destroy();
		}
		Traffic.Remove(Id);
	}
}
