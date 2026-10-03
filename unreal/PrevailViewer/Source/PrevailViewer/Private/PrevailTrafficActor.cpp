#include "PrevailTrafficActor.h"
#include "UObject/ConstructorHelpers.h"

APrevailTrafficActor::APrevailTrafficActor()
{
	PrimaryActorTick.bCanEverTick = false;
	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	SetRootComponent(Body);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (Cube.Succeeded())
	{
		Body->SetStaticMesh(Cube.Object);
	}
	Body->SetWorldScale3D(FVector(4.2f, 1.9f, 1.5f));
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void APrevailTrafficActor::ApplyPose(const FVector& Location, float YawDeg)
{
	SetActorLocationAndRotation(Location, FRotator(0.0f, YawDeg, 0.0f));
}
