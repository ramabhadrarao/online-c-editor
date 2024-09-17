#include<stdio.h>
int main(){
    int mango_rate,total,quantity;
    printf("Enter one Mango Rate:");
    scanf("%d",&mango_rate);
    printf("Enter No of Mangos:");
    scanf("%d",&quantity);
    total=mango_rate*quantity;
    printf("Total Mangos Cost is %d",total);
    
    return 0;
}