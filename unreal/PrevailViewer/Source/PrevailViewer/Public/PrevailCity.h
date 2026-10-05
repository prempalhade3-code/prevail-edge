#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "PrevailCity.generated.h"

class UHierarchicalInstancedStaticMeshComponent;
class UProceduralMeshComponent;
class UStaticMeshComponent;

UCLASS()
class PREVAILVIEWER_API APrevailCity : public AActor
{
	GENERATED_BODY()

public:
	APrevailCity();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	void SetFocus(const FVector& WorldLocation);

private:
	struct FPlacement
	{
		FVector Location = FVector::ZeroVector;
		float Yaw = 0.0f;
		FVector Scale = FVector::OneVector;
		int32 Bucket = 0;
	};

	struct FRoad
	{
		float HalfWidth = 400.0f;
		int32 Rank = 1;
		TArray<FVector2D> Pts;
	};

	void LoadScene();
	bool ReadSceneFile(FString& OutJson) const;
	void BuildGround();
	void BuildRoads();
	void BuildEdges();
	void Refill(const FVector& Focus);
	UMaterialInstanceDynamic* MakeColor(const FLinearColor& Color);
	UHierarchicalInstancedStaticMeshComponent* MakePool(UStaticMesh* Mesh, UMaterialInterface* Material);

	UPROPERTY()
	TObjectPtr<USceneComponent> Root;

	UPROPERTY()
	TObjectPtr<UStaticMeshComponent> Ground;

	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> RoadsMesh;

	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> MarkingsMesh;

	UPROPERTY()
	TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Houses;

	UPROPERTY()
	TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Offices;

	UPROPERTY()
	TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Towers;

	UPROPERTY()
	TObjectPtr<UHierarchicalInstancedStaticMeshComponent> Trees;

	TArray<FRoad> Roads;
	TArray<FVector2D> Route;
	TArray<FPlacement> Buildings;
	TArray<FPlacement> Canopies;
	FVector LastFill = FVector(1.0e12f, 1.0e12f, 0.0f);
	bool bRoadsBuilt = false;
};
