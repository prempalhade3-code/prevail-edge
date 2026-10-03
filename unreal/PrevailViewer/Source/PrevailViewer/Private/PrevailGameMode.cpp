#include "PrevailGameMode.h"
#include "Engine/StaticMeshActor.h"
#include "Kismet/GameplayStatics.h"
#include "PrevailGeo.h"
#include "PrevailHud.h"
#include "PrevailLiveSubsystem.h"
#include "PrevailTrafficActor.h"
#include "PrevailVehiclePawn.h"

APrevailGameMode::APrevailGameMode()
{
	DefaultPawnClass = APrevailVehiclePawn::StaticClass();
	HUDClass = APrevailHud::StaticClass();
}

void APrevailGameMode::BeginPlay()
{
	Super::BeginPlay();
	SpawnGround();

	if (UGameInstance* GI = GetGameInstance())
	{
		if (UPrevailLiveSubsystem* Live = GI->GetSubsystem<UPrevailLiveSubsystem>())
		{
			Live->OnSnapshot.AddDynamic(this, &APrevailGameMode::SyncTraffic);
		}
	}
}

void APrevailGameMode::SpawnGround()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AStaticMeshActor* Ground = World->SpawnActor<AStaticMeshActor>(FVector::ZeroVector, FRotator::ZeroRotator, Params);
	if (!Ground)
	{
		return;
	}

	if (UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane")))
	{
		Ground->GetStaticMeshComponent()->SetStaticMesh(Plane);
	}
	Ground->SetActorScale3D(FVector(4000.0f, 4000.0f, 1.0f));
	Ground->SetActorLocation(FVector(0.0f, 0.0f, 0.0f));
}

void APrevailGameMode::SyncTraffic(const FPrevailSnapshot& Snapshot)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	TSet<FString> Seen;
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
			Traffic.Add(Car.VehicleId, Actor);
		}
		Actor->ApplyPose(
			PrevailGeo::LatLonToUnreal(Car.Latitude, Car.Longitude, 80.0),
			PrevailGeo::HeadingToYaw(Car.HeadingDeg));
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
